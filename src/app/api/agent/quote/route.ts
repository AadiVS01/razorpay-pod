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
      items: rawItems,
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

    // 1. Normalize items list from request
    let items: Array<{ id: string; quantity: number; size?: string; color?: string }> = [];
    if (Array.isArray(rawItems) && rawItems.length > 0) {
      items = rawItems.map((it: any) => ({
        id: it.id || it.product_id,
        quantity: Math.max(1, parseInt(String(it.quantity || 1), 10) || 1),
        size: it.size || "Standard",
        color: it.color
      })).filter((it: any) => Boolean(it.id));
    } else if (product_id && size) {
      items = [{
        id: product_id,
        quantity: Math.max(1, parseInt(String(quantity), 10) || 1),
        size: size
      }];
    }

    if (items.length === 0) {
      return NextResponse.json(
        { status: "error", error: "MISSING_PARAMETERS", details: "Required: 'items' array (with id & quantity) OR ('product_id' and 'size')" },
        { status: 400 }
      );
    }

    const config = getMerchantConfig();
    const activeVersion = getActivePolicyVersion();

    // 2. Enforce Global Negotiation Policy if bid price provided
    const primaryProductId = items[0].id;
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

    // 3. Enforce Product Override if single item bid price provided
    if (items.length === 1 && bid_price_paise !== undefined) {
      const override = config.product_overrides[primaryProductId];
      const isNegotiable = override ? override.negotiable : true;
      if (!isNegotiable) {
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
    }

    const supabase = getAdminSupabase() || supabasePublic;
    if (!supabase) {
      return NextResponse.json(
        { status: "error", error: "DATABASE_UNAVAILABLE" },
        { status: 500 }
      );
    }

    // 4. Fetch all requested products from Supabase to check existence & stock
    const productIds = Array.from(new Set(items.map(it => it.id)));
    const { data: dbProducts, error: prodErr } = await supabase
      .from("products")
      .select("*")
      .in("id", productIds);

    if (prodErr || !dbProducts || dbProducts.length === 0) {
      return NextResponse.json(
        { status: "error", error: "PRODUCT_NOT_FOUND", details: "Requested products not found in catalog." },
        { status: 404 }
      );
    }

    const dbProductMap = new Map<string, any>(dbProducts.map((p: any) => [p.id, p]));

    // Check stock for all items
    for (const item of items) {
      const p = dbProductMap.get(item.id);
      if (!p) {
        return NextResponse.json(
          { status: "error", error: "PRODUCT_NOT_FOUND", details: `Product with ID ${item.id} not found.` },
          { status: 404 }
        );
      }
      if (p.stock < item.quantity) {
        await appendAuditEvent({
          actor: "Merchant Revenue Agent",
          action: "CHECKOUT_BLOCKED",
          session_id,
          cart_id,
          quote_id: null,
          order_id: null,
          policy_version: activeVersion,
          amount_before: Math.round((p.price * item.quantity) / 100),
          amount_after: null,
          policy_result: "BLOCKED",
          reason_code: "OUT_OF_STOCK",
          outcome: "FAILED",
          details: `Product "${p.name}" has insufficient stock (${p.stock} available, ${item.quantity} requested).`
        });

        return NextResponse.json(
          { status: "error", error: "OUT_OF_STOCK", details: `Product "${p.name}" has insufficient stock.` },
          { status: 422 }
        );
      }
    }

    // 5. Validate Minimum Allowed Price for Negotiation (single-product bid check)
    if (items.length === 1 && bid_price_paise !== undefined && bid_price_paise !== null) {
      const singleProd = dbProductMap.get(items[0].id);
      const baseUnitPrice = singleProd.price; // paise
      const override = config.product_overrides[items[0].id];
      const maxDiscountPct = override ? override.max_discount_percent : 10;
      const minAcceptedUnitPrice = Math.round(baseUnitPrice * (1 - maxDiscountPct / 100));

      let effectiveUnitBid = bid_price_paise;
      if (bid_price_paise > baseUnitPrice && items[0].quantity > 1) {
        effectiveUnitBid = Math.round(bid_price_paise / items[0].quantity);
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
          amount_before: Math.round((baseUnitPrice * items[0].quantity) / 100),
          amount_after: Math.round((bid_price_paise * items[0].quantity) / 100),
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

    // 6. Calculate Full Authoritative Cart Pricing
    const pricing = await calculateCartPricing({
      items,
      buyerContext: resolvedBuyerContext,
      cartId: cart_id,
      policyVersion: activeVersion,
      bidPricePaise: bid_price_paise,
      negotiatedProductId: items.length === 1 ? primaryProductId : undefined,
      bidTargetType: (bid_price_paise && items.length === 1 && bid_price_paise <= dbProductMap.get(primaryProductId).price) ? "unit" : "cart"
    });

    const finalAgreedTotalPaise = pricing.final_total_paise;

    // 7. Generate Cryptographically Signed Quote Token binding the FINAL CART TOTAL
    const { quoteId, expiresAt } = signQuoteToken({
      productId: items.length === 1 ? primaryProductId : undefined,
      items: items.map(it => ({ id: it.id, quantity: it.quantity, size: it.size, color: it.color })),
      finalTotalPaise: finalAgreedTotalPaise,
      size: items[0].size || "Standard",
      quantity: items.reduce((sum, it) => sum + it.quantity, 0),
      cartId: cart_id,
      policyVersion: activeVersion,
      expirySeconds: config.policy.quote_expiry_seconds
    });

    const originalInr = Math.round(pricing.subtotal_paise / 100);
    const agreedInr = Math.round(finalAgreedTotalPaise / 100);
    const savingsInr = Math.max(0, originalInr - agreedInr);
    const itemsDescription = items.map(it => `${dbProductMap.get(it.id)?.name || it.id} (Qty: ${it.quantity}${it.size ? `, Size: ${it.size}` : ""})`).join(" + ");

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
      intent_summary: `Buyer agent quoted price for ${itemsDescription}`,
      matched_rules: pricing.applied_rules.map(r => r.rule_id),
      arithmetic: {
        subtotal: originalInr,
        discount: savingsInr,
        final_total: agreedInr,
        buyer_savings: savingsInr,
        incremental_revenue: items.length > 1 ? agreedInr : 0
      }
    });

    console.log(`✅ [QUOTE] Signed quote for ${itemsDescription}. Agreed Cart Total: ₹${(finalAgreedTotalPaise / 100).toFixed(2)} under ${activeVersion}`);

    const primaryLine = pricing.lines[0];
    const totalDeliveredQty = items.reduce((sum, it) => sum + it.quantity, 0);

    return NextResponse.json({
      status: "ACCEPTED",
      quote_id: quoteId,
      policy_version: activeVersion,
      product_id: items.length === 1 ? primaryProductId : undefined,
      quantity: totalDeliveredQty,
      unit_price_paise: items.length === 1 ? dbProductMap.get(primaryProductId).price : undefined,
      subtotal_paise: pricing.subtotal_paise,
      discount_paise: pricing.discount_paise,
      agreed_price_paise: finalAgreedTotalPaise,
      currency: "INR",
      expires_at: new Date(expiresAt).toISOString(),
      applied_rules: pricing.applied_rules,
      excluded_rules: pricing.excluded_rules,
      paid_quantity: primaryLine ? primaryLine.paid_quantity : totalDeliveredQty,
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
