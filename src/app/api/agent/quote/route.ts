import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase, supabasePublic } from "@/lib/supabase";
import { getMerchantConfig, getActivePolicyVersion } from "@/lib/merchant-config";
import { appendAuditEvent } from "@/lib/audit-ledger";
import { calculateCartPricing, signQuoteToken } from "@/lib/cart-pricing";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { status: "error", error: "INVALID_JSON", details: "Malformed JSON payload in request." },
        { status: 400 }
      );
    }

    const {
      product_id,
      bid_price_paise,
      size,
      quantity = 1,
      cart_id = "default_cart",
      session_id = `sess_${Date.now()}`,
      buyer_context = {},
      buyerContext = {}
    } = body || {};

    const resolvedBuyerContext = { ...buyerContext, ...buyer_context };

    if (!product_id || !size) {
      return NextResponse.json(
        { status: "error", error: "MISSING_PARAMETERS", details: "Required: product_id, size" },
        { status: 400 }
      );
    }

    const parsedQty = Math.max(1, parseInt(String(quantity), 10) || 1);
    const config = getMerchantConfig();
    const activeVersion = getActivePolicyVersion();

    // 1. Enforce Global Negotiation Policy
    if (!config.policy.agent_can_negotiate && bid_price_paise !== undefined) {
      await appendAuditEvent({
        actor: "Merchant Revenue Agent",
        action: "CHECKOUT_BLOCKED",
        session_id,
        cart_id,
        quote_id: null,
        order_id: null,
        policy_version: activeVersion,
        amount_before: bid_price_paise ? Math.round(bid_price_paise / 100) : null,
        amount_after: null,
        policy_result: "BLOCKED",
        reason_code: "BID_TOO_LOW",
        outcome: "FAILED",
        details: "Negotiation is currently disabled by global merchant settings."
      });

      return NextResponse.json(
        {
          status: "REJECTED",
          error: "NEGOTIATION_DISABLED",
          details: "Negotiation is currently disabled by global merchant settings."
        },
        { status: 422 }
      );
    }

    // 2. Enforce Product Override
    const override = config.product_overrides[product_id];
    const isNegotiable = override ? override.negotiable : true;
    if (!isNegotiable && bid_price_paise !== undefined) {
      await appendAuditEvent({
        actor: "Merchant Revenue Agent",
        action: "CHECKOUT_BLOCKED",
        session_id,
        cart_id,
        quote_id: null,
        order_id: null,
        policy_version: activeVersion,
        amount_before: bid_price_paise ? Math.round(bid_price_paise / 100) : null,
        amount_after: null,
        policy_result: "BLOCKED",
        reason_code: "BID_TOO_LOW",
        outcome: "FAILED",
        details: "Negotiation for this product has been disabled by merchant overrides."
      });

      return NextResponse.json(
        {
          status: "REJECTED",
          error: "NEGOTIATION_DISABLED",
          details: "Negotiation for this product has been disabled by merchant overrides."
        },
        { status: 422 }
      );
    }

    const supabase = getAdminSupabase() || supabasePublic;
    if (!supabase) {
      return NextResponse.json(
        { status: "error", error: "DATABASE_UNAVAILABLE" },
        { status: 500 }
      );
    }

    // 3. Fetch product from Supabase to check base price & stock
    const { data: product, error } = await supabase
      .from("products")
      .select("*")
      .eq("id", product_id)
      .single();

    if (error || !product) {
      return NextResponse.json(
        { status: "error", error: "PRODUCT_NOT_FOUND", details: `Product with ID ${product_id} not found.` },
        { status: 404 }
      );
    }

    if (product.stock < parsedQty) {
      await appendAuditEvent({
        actor: "Merchant Revenue Agent",
        action: "CHECKOUT_BLOCKED",
        session_id,
        cart_id,
        quote_id: null,
        order_id: null,
        policy_version: activeVersion,
        amount_before: Math.round((product.price * parsedQty) / 100),
        amount_after: null,
        policy_result: "BLOCKED",
        reason_code: "OUT_OF_STOCK",
        outcome: "FAILED",
        details: `Product "${product.name}" has insufficient stock (${product.stock} available, ${parsedQty} requested).`
      });

      return NextResponse.json(
        { status: "error", error: "OUT_OF_STOCK", details: "Product has insufficient stock." },
        { status: 422 }
      );
    }

    // 4. Validate Minimum Allowed Price for Negotiation
    const baseUnitPrice = product.price; // paise
    const maxDiscountPct = override ? override.max_discount_percent : 10;
    const minAcceptedUnitPrice = Math.round(baseUnitPrice * (1 - maxDiscountPct / 100));

    if (bid_price_paise !== undefined && bid_price_paise !== null) {
      // Determine if bid was per unit or per full cart
      let effectiveUnitBid = bid_price_paise;
      if (bid_price_paise > baseUnitPrice && parsedQty > 1) {
        effectiveUnitBid = Math.round(bid_price_paise / parsedQty);
      }

      if (effectiveUnitBid < minAcceptedUnitPrice) {
        await appendAuditEvent({
          actor: "Merchant Revenue Agent",
          action: "CHECKOUT_BLOCKED",
          session_id,
          cart_id,
          quote_id: null,
          order_id: null,
          policy_version: activeVersion,
          amount_before: Math.round((baseUnitPrice * parsedQty) / 100),
          amount_after: Math.round((bid_price_paise * parsedQty) / 100),
          policy_result: "BLOCKED",
          reason_code: "BID_TOO_LOW",
          outcome: "FAILED",
          details: `Bid rejected: ₹${(effectiveUnitBid / 100).toFixed(2)}/unit is below minimum allowed price of ₹${(minAcceptedUnitPrice / 100).toFixed(2)}.`
        });

        return NextResponse.json(
          {
            status: "REJECTED",
            error: "BID_TOO_LOW",
            details: `Bid rejected: ₹${(effectiveUnitBid / 100).toFixed(2)} is below the merchant’s minimum accepted price of ₹${(minAcceptedUnitPrice / 100).toFixed(2)}.`,
            suggested_action: `submit a bid of at least ₹${(minAcceptedUnitPrice / 100).toFixed(2)} per unit or choose an active bundle offer.`
          },
          { status: 422 }
        );
      }
    }

    // 5. Calculate Full Authoritative Cart Pricing
    const pricing = await calculateCartPricing({
      items: [{ id: product_id, quantity: parsedQty, size }],
      buyerContext: resolvedBuyerContext,
      cartId: cart_id,
      policyVersion: activeVersion,
      bidPricePaise: bid_price_paise,
      negotiatedProductId: product_id,
      bidTargetType: (bid_price_paise && bid_price_paise <= baseUnitPrice) ? "unit" : "cart"
    });

    const finalAgreedTotalPaise = pricing.final_total_paise;

    // 6. Generate Cryptographically Signed Quote Token binding the FINAL CART TOTAL
    const { quoteId, expiresAt } = signQuoteToken({
      productId: product_id,
      finalTotalPaise: finalAgreedTotalPaise,
      size,
      quantity: parsedQty,
      cartId: cart_id,
      policyVersion: activeVersion,
      expirySeconds: config.policy.quote_expiry_seconds
    });

    const originalInr = Math.round(pricing.subtotal_paise / 100);
    const agreedInr = Math.round(finalAgreedTotalPaise / 100);
    const savingsInr = Math.max(0, originalInr - agreedInr);

    await appendAuditEvent({
      actor: "Merchant Revenue Agent",
      action: "QUOTE_ISSUED",
      session_id,
      cart_id,
      quote_id: quoteId,
      order_id: null,
      policy_version: activeVersion,
      amount_before: originalInr,
      amount_after: agreedInr,
      policy_result: "ALLOWED",
      reason_code: "SUCCESS",
      outcome: "COMPLETED",
      details: `Generated cryptographically signed quote under policy ${activeVersion}. Total approved price: ₹${agreedInr} (Saved ₹${savingsInr}). Applied Rules: ${pricing.applied_rules.map(r => r.rule_name).join(", ") || "None"}.`,
      intent_summary: `Buyer agent quoted price for ${product.name} (Qty: ${parsedQty}, Size: ${size})`,
      matched_rules: pricing.applied_rules.map(r => r.rule_id),
      arithmetic: {
        subtotal: originalInr,
        discount: savingsInr,
        final_total: agreedInr,
        buyer_savings: savingsInr,
        incremental_revenue: 0
      }
    });

    console.log(`✅ [QUOTE] Signed quote for product ${product.name} (Qty ${parsedQty}). Agreed Cart Total: ₹${(finalAgreedTotalPaise / 100).toFixed(2)} under ${activeVersion}`);

    const primaryLine = pricing.lines[0];

    return NextResponse.json({
      status: "ACCEPTED",
      quote_id: quoteId,
      policy_version: activeVersion,
      product_id,
      quantity: parsedQty,
      unit_price_paise: baseUnitPrice,
      subtotal_paise: pricing.subtotal_paise,
      discount_paise: pricing.discount_paise,
      agreed_price_paise: finalAgreedTotalPaise,
      currency: "INR",
      expires_at: new Date(expiresAt).toISOString(),
      applied_rules: pricing.applied_rules,
      excluded_rules: pricing.excluded_rules,
      paid_quantity: primaryLine ? primaryLine.paid_quantity : parsedQty,
      free_quantity: primaryLine ? primaryLine.free_quantity : 0,
      lines: pricing.lines
    }, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      }
    });

  } catch (err: any) {
    console.error("Agent Quote API error:", err);
    return NextResponse.json(
      { status: "error", error: "QUOTE_INTERNAL_ERROR", details: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
