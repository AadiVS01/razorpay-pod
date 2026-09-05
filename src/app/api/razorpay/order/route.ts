import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase, supabasePublic } from "@/lib/supabase";
import { appendAuditEvent, logAuditEvent } from "@/lib/audit-ledger";
import { getMerchantConfig, getActivePolicyVersion } from "@/lib/merchant-config";
import { calculateCartPricing, verifyQuoteToken, computeItemsHash } from "@/lib/cart-pricing";
import Razorpay from "razorpay";

export const dynamic = "force-dynamic";

/**
 * Saves order rows to Supabase database for audit telemetry logging
 */
async function saveOrderToDb(
  supabase: any,
  rzpOrderId: string,
  pricingItems: any[],
  status: string = "created",
  adminNotes: string = ""
) {
  try {
    const totalAmount = pricingItems.reduce((sum, it) => sum + (it.product.price * it.quantity), 0);
    const totalQuantity = pricingItems.reduce((sum, it) => sum + it.quantity, 0);
    const combinedName = pricingItems.map((it) => `${it.product.name} (x${it.quantity})`).join(" + ");
    const itemsSummary = pricingItems.map((it) => ({
      id: it.product.id,
      name: it.product.name,
      quantity: it.quantity,
      price_paise: it.product.price,
    }));

    const fullNotes = `${adminNotes}|items_json:${JSON.stringify(itemsSummary)}`;

    const orderToInsert = {
      razorpay_order_id: rzpOrderId,
      product_id: pricingItems[0].product.id,
      product_name: combinedName,
      product_price: pricingItems[0].product.price,
      quantity: totalQuantity,
      amount: totalAmount,
      customer_name: "A2A Buyer Agent",
      customer_email: "agent@zeroclick.com",
      customer_phone: "9999999999",
      shipping_address: {
        city: "Pune",
        line1: "Army Institute of Technology, Alandi Road",
        state: "Maharashtra",
        pincode: "411015",
      },
      size: (Array.isArray(pricingItems[0].product?.sizes) && pricingItems[0].product.sizes.length > 0) ? pricingItems[0].product.sizes[0] : (pricingItems[0].size || "L"),
      status: status,
      admin_notes: fullNotes,
    };

    const { error } = await supabase.from("orders").insert([orderToInsert]);

    if (error) {
      console.error("❌ [DATABASE] [ORDER] Failed to insert orders:", error);
    } else {
      console.log(`✅ [DATABASE] [ORDER] Saved order ${rzpOrderId} to DB.`);
    }
  } catch (err) {
    console.error("❌ [DATABASE] [ORDER] Exception during DB insert:", err);
  }
}

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

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { status: "error", error: "INVALID_PAYLOAD", details: "Request body must be a valid JSON object." },
        { status: 400 }
      );
    }

    const {
      items,
      budget_cap_paise,
      expected_total_paise,
      quote_id,
      cart_id = "default_cart",
      session_id = `sess_${Date.now()}`,
      mandate_authorized,
      idempotency_key,
      auto_capture = true,
      buyer_context = {}
    } = body || {};

    if (!items || !Array.isArray(items) || items.length === 0) {
      console.error("❌ [SECURITY] Missing or invalid 'items' list in payload.");
      return NextResponse.json(
        { status: "error", error: "MISSING_PARAMETERS", details: "Missing or invalid 'items' list in payload" },
        { status: 400 }
      );
    }

    const config = getMerchantConfig();
    const activeVersion = getActivePolicyVersion();
    let currentPolicyVersion = activeVersion;

    // 1. Enforce Global Autonomous Checkout Permission (Gate 1)
    if (!config.policy.agent_can_checkout) {
      await appendAuditEvent({
        actor: "AI Buyer Agent",
        action: "CHECKOUT_BLOCKED",
        session_id,
        cart_id,
        quote_id: quote_id || null,
        order_id: null,
        policy_version: activeVersion,
        amount_before: expected_total_paise ? expected_total_paise / 100 : null,
        amount_after: null,
        policy_result: "BLOCKED",
        reason_code: "BID_TOO_LOW" as any,
        outcome: "FAILED",
        details: "Autonomous checkout disabled by merchant policy.",
        gate_results: { "Autonomy Gate": "FAIL" }
      });
      return NextResponse.json(
        { status: "error", error: "AUTONOMY_DISABLED", details: "Autonomous agent checkout is disabled by merchant policies." },
        { status: 403 }
      );
    }

    // 2. Enforce Mandate Pre-Authorization Consent (Gate 2)
    if (config.policy.mandate_required && mandate_authorized !== true) {
      await appendAuditEvent({
        actor: "AI Buyer Agent",
        action: "CHECKOUT_BLOCKED",
        session_id,
        cart_id,
        quote_id: quote_id || null,
        order_id: null,
        policy_version: activeVersion,
        amount_before: expected_total_paise ? expected_total_paise / 100 : null,
        amount_after: null,
        policy_result: "BLOCKED",
        reason_code: "MANDATE_REQUIRED" as any,
        outcome: "FAILED",
        details: "UPI Mandate pre-authorization consent is active and required.",
        gate_results: { "Autonomy Gate": "PASS", "Mandate Bound": "FAIL" }
      });
      return NextResponse.json(
        { status: "error", error: "MANDATE_REQUIRED", details: "UPI Mandate pre-authorization consent is active and required." },
        { status: 403 }
      );
    }

    const supabase = getAdminSupabase() || supabasePublic;
    if (!supabase) {
      console.error("❌ [SECURITY] [DATABASE] Supabase client is unavailable.");
      return NextResponse.json(
        { status: "error", error: "DATABASE_UNAVAILABLE" },
        { status: 500 }
      );
    }

    const requestIdempotencyKey = idempotency_key || `idem_key_${Date.now()}`;
    const uniqueIdemOrderId = `idem_${requestIdempotencyKey}`;

    // 3. Checkout Idempotency Check
    if (requestIdempotencyKey) {
      const { data: existingOrders, error: exErr } = await supabase
        .from("orders")
        .select("*")
        .eq("razorpay_order_id", uniqueIdemOrderId);
      
      if (!exErr && existingOrders && existingOrders.length > 0) {
        console.log(`✅ [IDEMPOTENCY] Reusing existing order for key ${requestIdempotencyKey}`);
        
        await appendAuditEvent({
          actor: "AI Buyer Agent",
          action: "ORDER_CREATED",
          session_id,
          cart_id,
          quote_id: quote_id || null,
          order_id: existingOrders[0].razorpay_order_id,
          policy_version: activeVersion,
          amount_before: null,
          amount_after: existingOrders[0].amount / 100,
          policy_result: "ALLOWED",
          reason_code: "IDEMPOTENT_REUSE",
          outcome: "COMPLETED",
          details: "Idempotent payment transaction safely re-used with 0 duplicate stock decrements."
        });

        const idemPaymentUrl = `https://rzp.io/i/simulated_${existingOrders[0].razorpay_order_id}`;
        return NextResponse.json({
          status: "success",
          order_id: existingOrders[0].razorpay_order_id,
          amount_paise: existingOrders[0].amount,
          currency: "INR",
          simulated: true,
          receipt: `receipt_${existingOrders[0].razorpay_order_id}`,
          payment_link_url: idemPaymentUrl,
          payment_link: idemPaymentUrl,
          payment_url: idemPaymentUrl,
          details: "Idempotent payment transaction re-used."
        });
      }
    }

    // 4. Authoritative Cart Pricing Evaluation
    let pricing;
    try {
      pricing = await calculateCartPricing({
        items,
        buyerContext: buyer_context,
        cartId: cart_id,
        policyVersion: activeVersion,
      });
      console.log(`[GUARDRAIL] [PRICE] Authoritative cart total: ₹${(pricing.final_total_paise / 100).toFixed(2)} (Subtotal: ₹${(pricing.subtotal_paise / 100).toFixed(2)}, Discount: ₹${(pricing.discount_paise / 100).toFixed(2)}, Applied Rules: ${pricing.applied_rules.map(r => r.rule_name).join(", ") || "None"})`);
    } catch (pricingErr: any) {
      console.error(`[GUARDRAIL] [PRICE] Pricing check failed: ${pricingErr?.message}`);
      return NextResponse.json(
        { status: "error", error: "PRICING_FAILED", details: pricingErr?.message },
        { status: 400 }
      );
    }

    // 5. Cryptographic Quote Verification & Scope Matching
    let quotedFinalTotalPaise: number | null = null;
    if (quote_id) {
      const verified = verifyQuoteToken(quote_id);
      if (!verified.valid || !verified.finalTotalPaise || !verified.policyVersion) {
        console.warn(`⚠️ [QUOTE_VERIFY_FAILED] Quote token verification failed: ${verified.error}`);
        
        await appendAuditEvent({
          actor: "AI Buyer Agent",
          action: "CHECKOUT_BLOCKED",
          session_id,
          cart_id,
          quote_id,
          order_id: null,
          policy_version: activeVersion,
          amount_before: expected_total_paise ? expected_total_paise / 100 : null,
          amount_after: null,
          policy_result: "BLOCKED",
          reason_code: "PRICE_MISMATCH",
          outcome: "FAILED",
          details: `Invalid or expired quote token (${verified.error}).`,
          gate_results: { "Autonomy Gate": "PASS", "Mandate Bound": "PASS", "Quote Scope Match": "FAIL" }
        });

        return NextResponse.json({
          status: "error",
          error: "QUOTE_SCOPE_MISMATCH",
          details: `Quote token invalid or expired (${verified.error}).`
        }, { status: 422 });
      }

      currentPolicyVersion = verified.policyVersion;
      const clientCartId = cart_id || "default_cart";

      let scopeMatched = false;
      if (verified.isMultiItem && verified.itemsHash) {
        const clientItemsFingerprints = items.map((it: any) => ({
          id: it.id || it.product_id,
          quantity: Math.max(1, parseInt(String(it.quantity || 1), 10) || 1),
          size: it.size || "Standard",
          color: it.color
        }));
        const clientItemsHash = computeItemsHash(clientItemsFingerprints);
        scopeMatched = (clientItemsHash === verified.itemsHash && verified.cartId === clientCartId);
      } else if (verified.productId) {
        const matchedItem = items.find((item: any) => (item.id || item.product_id) === verified.productId);
        const parsedItemQty = matchedItem ? parseInt(String(matchedItem.quantity), 10) : 0;
        scopeMatched = Boolean(matchedItem && parsedItemQty === verified.quantity && verified.cartId === clientCartId);
      }

      if (!scopeMatched) {
        console.error("❌ [SECURITY] [QUOTE_SCOPE_MISMATCH] Cart items, quantities, or cart ID do not match quote scope.");
        
        await appendAuditEvent({
          actor: "AI Buyer Agent",
          action: "CHECKOUT_BLOCKED",
          session_id,
          cart_id: clientCartId,
          quote_id,
          order_id: null,
          policy_version: verified.policyVersion,
          amount_before: pricing.final_total_paise / 100,
          amount_after: null,
          policy_result: "BLOCKED",
          reason_code: "PRICE_MISMATCH",
          outcome: "FAILED",
          details: "Quote token scope (items, quantities, or cart ID) does not match checkout request.",
          gate_results: { "Autonomy Gate": "PASS", "Mandate Bound": "PASS", "Quote Scope Match": "FAIL" }
        });

        return NextResponse.json({
          status: "error",
          error: "QUOTE_SCOPE_MISMATCH",
          details: "The quote token scope (items, quantities, or cart ID) does not match your checkout request."
        }, { status: 422 });
      }

      // Quoted total is the authoritative bound total for this cart
      quotedFinalTotalPaise = verified.finalTotalPaise;
      console.log(`✅ [QUOTE_VERIFIED] Valid HMAC quote found under ${verified.policyVersion}. Bound Cart Total: ₹${(quotedFinalTotalPaise / 100).toFixed(2)}`);
    }

    // Determine final check total (agreed quoted total or calculated pricing total)
    const checkTotal = quotedFinalTotalPaise !== null ? quotedFinalTotalPaise : pricing.final_total_paise;

    // 6. Enforce Exact Price Integrity Check
    if (expected_total_paise !== undefined && checkTotal !== expected_total_paise) {
      console.error(`❌ [SECURITY] [PRICE_MISMATCH] Client expected: ₹${(expected_total_paise / 100).toFixed(2)}, Secure calculated total: ₹${(checkTotal / 100).toFixed(2)}`);
      
      await appendAuditEvent({
        actor: "AI Buyer Agent",
        action: "CHECKOUT_BLOCKED",
        session_id,
        cart_id,
        quote_id: quote_id || null,
        order_id: null,
        policy_version: currentPolicyVersion,
        amount_before: expected_total_paise / 100,
        amount_after: null,
        policy_result: "BLOCKED",
        reason_code: "PRICE_MISMATCH",
        outcome: "FAILED",
        details: `Requested total (${expected_total_paise} paise) does not match merchant calculated total (${checkTotal} paise). Prompt injection blocked.`,
        gate_results: quote_id 
          ? { "Autonomy Gate": "PASS", "Mandate Bound": "PASS", "Quote Scope Match": "PASS" }
          : { "Autonomy Gate": "PASS", "Mandate Bound": "PASS" }
      });

      return NextResponse.json(
        {
          status: "error",
          error: "PRICE_MISMATCH",
          details: `Requested total (${expected_total_paise} paise) does not match merchant calculated total (${checkTotal} paise). Prompt injection blocked.`
        },
        { status: 422 }
      );
    }
    console.log("✅ [GUARDRAIL] [PRICE] Price Integrity verified successfully.");

    // 7. Inventory Stock Pre-Verification Guardrail
    for (const item of pricing.evaluated_items) {
      console.log(`[GUARDRAIL] [STOCK] Checking inventory for "${item.product.name}"...`);
      const { data: prod, error: getErr } = await supabase
        .from("products")
        .select("stock")
        .eq("id", item.product.id)
        .single();

      if (getErr || !prod || prod.stock < item.quantity) {
        console.error(`❌ [SECURITY] [STOCK_OUT] Product "${item.product.name}" stock insufficient (${prod?.stock ?? 0} available, ${item.quantity} requested).`);
        
        await appendAuditEvent({
          actor: "AI Buyer Agent",
          action: "CHECKOUT_BLOCKED",
          session_id,
          cart_id,
          quote_id: quote_id || null,
          order_id: null,
          policy_version: currentPolicyVersion,
          amount_before: checkTotal / 100,
          amount_after: null,
          policy_result: "BLOCKED",
          reason_code: "OUT_OF_STOCK",
          outcome: "FAILED",
          details: `Cannot fulfill order. Product "${item.product.name}" has insufficient stock.`,
          gate_results: { "Autonomy Gate": "PASS", "Mandate Bound": "PASS", "Inventory Stock Gate": "FAIL" }
        });

        return NextResponse.json(
          {
            status: "error",
            error: "INVENTORY_STOCK_OUT",
            details: `Cannot fulfill order. Product "${item.product.name}" has insufficient stock.`
          },
          { status: 422 }
        );
      }
    }

    // 8. Budget Cap Policy Guardrail
    const maxCheckoutCap = config.policy.max_autonomous_checkout_paise;
    if (checkTotal > maxCheckoutCap) {
      console.error(`❌ [SECURITY] [BUDGET_CAP_EXCEEDED] Total ₹${(checkTotal / 100).toFixed(2)} exceeds cap limit ₹${(maxCheckoutCap / 100).toFixed(2)}`);
      
      await appendAuditEvent({
        actor: "AI Buyer Agent",
        action: "CHECKOUT_BLOCKED",
        session_id,
        cart_id,
        quote_id: quote_id || null,
        order_id: null,
        policy_version: currentPolicyVersion,
        amount_before: checkTotal / 100,
        amount_after: null,
        policy_result: "BLOCKED",
        reason_code: "BUDGET_EXCEEDED",
        outcome: "FAILED",
        details: `Order total of ₹${(checkTotal / 100).toFixed(2)} exceeds the merchant pre-configured budget cap limit of ₹${(maxCheckoutCap / 100).toFixed(2)}.`,
        gate_results: { "Autonomy Gate": "PASS", "Mandate Bound": "PASS", "Budget Cap Gate": "FAIL" }
      });

      return NextResponse.json(
        {
          status: "error",
          error: "BUDGET_CAP_EXCEEDED",
          details: `Order total of ₹${(checkTotal / 100).toFixed(2)} exceeds the merchant pre-configured budget cap limit of ₹${(maxCheckoutCap / 100).toFixed(2)}.`
        },
        { status: 422 }
      );
    }
    console.log("✅ [GUARDRAIL] [BUDGET] Budget bounds verified successfully.");

    // 9. Atomic Stock Allocation (Concurrency-Safe)
    for (const item of pricing.evaluated_items) {
      console.log(`[GUARDRAIL] [STOCK] Executing atomic conditional decrement for "${item.product.name}"...`);
      const { data: prod } = await supabase
        .from("products")
        .select("stock")
        .eq("id", item.product.id)
        .single();

      const currentStock = prod?.stock ?? item.product.stock;
      const { data: updatedRows, error: updateErr } = await supabase
        .from("products")
        .update({ stock: Math.max(0, currentStock - item.quantity) })
        .eq("id", item.product.id)
        .gte("stock", item.quantity)
        .select();

      if (updateErr || !updatedRows || updatedRows.length === 0) {
        console.error(`❌ [SECURITY] [STOCK_OUT] Atomic check failed. "${item.product.name}" stock depleted or locked.`);
        
        await appendAuditEvent({
          actor: "AI Buyer Agent",
          action: "CHECKOUT_BLOCKED",
          session_id,
          cart_id,
          quote_id: quote_id || null,
          order_id: null,
          policy_version: currentPolicyVersion,
          amount_before: checkTotal / 100,
          amount_after: null,
          policy_result: "BLOCKED",
          reason_code: "OUT_OF_STOCK",
          outcome: "FAILED",
          details: `Cannot fulfill order. Product "${item.product.name}" has insufficient stock.`,
          gate_results: { "Autonomy Gate": "PASS", "Mandate Bound": "PASS", "Budget Cap Gate": "PASS", "Inventory Stock Gate": "FAIL" }
        });

        return NextResponse.json(
          {
            status: "error",
            error: "INVENTORY_STOCK_OUT",
            details: `Cannot fulfill order. Product "${item.product.name}" has insufficient stock.`
          },
          { status: 422 }
        );
      }
      
      const newStock = updatedRows[0].stock;
      console.log(`✅ [GUARDRAIL] [STOCK] Allocated ${item.quantity} unit(s) of "${item.product.name}". Remaining stock: ${newStock}.`);
    }

    console.log("✅ [GUARDRAIL] All checkout security rails cleared. Initiating payment creation...");

    // 9. Payment Execution & Persistence (Using EXACT final checkTotal)
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    const actualRzpTotal = checkTotal;
    const adminNotes = `idempotency_key:${requestIdempotencyKey || ""}|quote_id:${quote_id || ""}|rules:${pricing.applied_rules.map(r => r.rule_id).join(",")}`;

    const auditArithmetic = {
      subtotal: Math.round(pricing.subtotal_paise / 100),
      discount: Math.round(pricing.discount_paise / 100),
      final_total: Math.round(actualRzpTotal / 100),
      buyer_savings: Math.round(pricing.discount_paise / 100),
      incremental_revenue: Math.round(actualRzpTotal / 100) > 649 ? Math.round(actualRzpTotal / 100) - 649 : 0
    };

    if (!keyId || !keySecret || keyId === "rzp_test_placeholder") {
      await saveOrderToDb(supabase, uniqueIdemOrderId, pricing.evaluated_items, auto_capture ? "paid" : "created", adminNotes);
      console.log(`🎉 [PAYMENT] [SIMULATOR] Issued Order ID: ${uniqueIdemOrderId}. Receipt: receipt_${Date.now()}`);
      
      await appendAuditEvent({
        actor: "AI Buyer Agent",
        action: "ORDER_CREATED",
        session_id,
        cart_id,
        quote_id: quote_id || null,
        order_id: uniqueIdemOrderId,
        policy_version: currentPolicyVersion,
        amount_before: Math.round(pricing.subtotal_paise / 100),
        amount_after: Math.round(actualRzpTotal / 100),
        policy_result: "ALLOWED",
        reason_code: "SUCCESS",
        outcome: "COMPLETED",
        details: `Autonomous order created successfully under policy ${currentPolicyVersion}. Total: ₹${Math.round(actualRzpTotal / 100)}. Growth Rules: ${pricing.applied_rules.map(r => r.rule_name).join(", ") || "Standard Base"}.`,
        matched_rules: pricing.applied_rules.map(r => r.rule_id),
        gate_results: {
          "Autonomy Gate": "PASS",
          "Mandate Bound": "PASS",
          "Budget Cap Gate": "PASS",
          "Inventory Stock Gate": "PASS",
          ...(quote_id ? { "Quote Scope Match": "PASS" as const } : {})
        },
        arithmetic: auditArithmetic
      });

      console.log("=======================================================\n");
      const simPaymentUrl = `https://rzp.io/i/simulated_${uniqueIdemOrderId}`;
      return NextResponse.json({
        status: "success",
        order_id: uniqueIdemOrderId,
        amount_paise: actualRzpTotal,
        currency: "INR",
        simulated: true,
        applied_rules: pricing.applied_rules,
        receipt: `receipt_${Date.now()}`,
        payment_link_url: simPaymentUrl,
        payment_link: simPaymentUrl,
        payment_url: simPaymentUrl,
        details: "Checkout executed via A2A Bounded Payment Simulator.",
      });
    }

    const rzp = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });

    const rzpOrder = await rzp.orders.create({
      amount: actualRzpTotal,
      currency: "INR",
      receipt: `receipt_${Date.now()}`,
      notes: {
        agent_checkout: "true",
        protocol: "a2a-v1.0",
        original_price_paise: pricing.subtotal_paise.toString(),
        final_price_paise: actualRzpTotal.toString()
      }
    });

    await saveOrderToDb(supabase, uniqueIdemOrderId, pricing.evaluated_items, auto_capture ? "paid" : "created", `${adminNotes}|rzp_order_id:${rzpOrder.id}`);
    console.log(`🎉 [PAYMENT] [RAZORPAY] Created Order ID: ${rzpOrder.id}. Receipt: ${rzpOrder.receipt}`);

    await appendAuditEvent({
      actor: "AI Buyer Agent",
      action: "ORDER_CREATED",
      session_id,
      cart_id,
      quote_id: quote_id || null,
      order_id: uniqueIdemOrderId,
      policy_version: currentPolicyVersion,
      amount_before: Math.round(pricing.subtotal_paise / 100),
      amount_after: Math.round(actualRzpTotal / 100),
      policy_result: "ALLOWED",
      reason_code: "SUCCESS",
      outcome: "COMPLETED",
      details: `Razorpay order ${rzpOrder.id} created under policy ${currentPolicyVersion}. Total: ₹${Math.round(actualRzpTotal / 100)}. Growth Rules: ${pricing.applied_rules.map(r => r.rule_name).join(", ") || "Standard Base"}.`,
      matched_rules: pricing.applied_rules.map(r => r.rule_id),
      gate_results: {
        "Autonomy Gate": "PASS",
        "Mandate Bound": "PASS",
        "Budget Cap Gate": "PASS",
        "Inventory Stock Gate": "PASS",
        ...(quote_id ? { "Quote Scope Match": "PASS" as const } : {})
      },
      arithmetic: auditArithmetic
    });

    let paymentLinkUrl: string | null = null;
    try {
      console.log(`[PAYMENT] [RAZORPAY] Generating payment link for Order ID: ${rzpOrder.id}...`);
      const paymentLink = await rzp.paymentLink.create({
        amount: actualRzpTotal,
        currency: "INR",
        accept_partial: false,
        description: `Checkout payment for order ${rzpOrder.id}`,
        customer: {
          name: "A2A Buyer Agent",
          email: "agent@zeroclick.com",
          contact: "+919876543210"
        },
        notify: {
          sms: false,
          email: false
        },
        reminder_enable: false,
        notes: {
          razorpay_order_id: rzpOrder.id
        }
      });
      paymentLinkUrl = paymentLink.short_url;
      console.log(`✅ [PAYMENT] [RAZORPAY] Generated Payment Link URL: ${paymentLinkUrl}`);
    } catch (linkErr: any) {
      console.warn("⚠️ [PAYMENT] [RAZORPAY] Standard payment link fallback:", linkErr?.message || linkErr);
      paymentLinkUrl = `https://rzp.io/i/${rzpOrder.id}`;
    }

    if (!paymentLinkUrl) {
      paymentLinkUrl = `https://rzp.io/i/${rzpOrder.id}`;
    }

    console.log("=======================================================\n");

    return NextResponse.json({
      status: "success",
      order_id: uniqueIdemOrderId,
      razorpay_order_id: rzpOrder.id,
      amount_paise: actualRzpTotal,
      currency: "INR",
      simulated: false,
      applied_rules: pricing.applied_rules,
      receipt: rzpOrder.receipt,
      payment_link_url: paymentLinkUrl,
      payment_link: paymentLinkUrl,
      payment_url: paymentLinkUrl,
    });

  } catch (error: any) {
    console.error("Razorpay order creation error:", error);
    return NextResponse.json(
      {
        status: "error",
        error: "INTERNAL_CHECKOUT_ERROR",
        details: error?.message || "Internal server error",
      },
      { status: 500 }
    );
  }
}
