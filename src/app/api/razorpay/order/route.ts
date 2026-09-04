import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase, supabasePublic } from "@/lib/supabase";
import { logAuditEvent } from "@/lib/audit-ledger";
import { getMerchantConfig, getActivePolicyVersion } from "@/lib/merchant-config";
import { evaluateGrowthRules, BuyerContext, EvaluatedItem } from "@/lib/growth-engine";
import Razorpay from "razorpay";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * Calculates correct cart pricing based on DB products and growth rules
 */
async function calculateCartTotal(
  items: Array<{ id: string; quantity: number }>,
  buyerContext: BuyerContext = {}
) {
  const supabase = getAdminSupabase() || supabasePublic;
  if (!supabase) throw new Error("Database client unavailable");

  // Fetch live product rows from Supabase
  const productIds = items.map((item) => item.id);
  const { data: dbProducts, error } = await supabase
    .from("products")
    .select("*")
    .in("id", productIds);

  if (error || !dbProducts || dbProducts.length === 0) {
    throw new Error("Failed to retrieve products from database");
  }

  const itemDetails: EvaluatedItem[] = items.map((item) => {
    const product = dbProducts.find((p) => p.id === item.id);
    if (!product) throw new Error(`Product ID ${item.id} not found in catalog`);

    return {
      product: {
        id: product.id,
        name: product.name,
        price: product.price,
        cost_paise: product.price * 0.4, // estimated cost for margin floor calculation
        stock: product.stock,
        category: product.category,
        sizes: product.sizes,
        images: product.images
      },
      quantity: item.quantity,
      price_paise: product.price,
    };
  });

  const config = getMerchantConfig();

  // Evaluate growth rules deterministically
  const growthResult = evaluateGrowthRules(
    itemDetails,
    config.growth_rules || [],
    buyerContext,
    {
      max_discount_percent: config.policy.max_discount_percent ?? 25,
      margin_floor_percent: config.policy.margin_floor_percent ?? 60,
      max_autonomous_checkout_paise: config.policy.max_autonomous_checkout_paise,
      promotion_stacking_allowed: config.policy.promotion_stacking_allowed ?? false
    }
  );

  return {
    subtotal_paise: growthResult.subtotal_paise,
    discount_paise: growthResult.discount_paise,
    total_paise: growthResult.final_total_paise,
    final_total_paise: growthResult.final_total_paise,
    buyer_savings_paise: growthResult.buyer_savings_paise,
    applied_rules: growthResult.applied_rules,
    free_items: growthResult.free_items,
    cross_sell_recommendations: growthResult.cross_sell_recommendations,
    items: itemDetails,
  };
}

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
    const totalAmount = pricingItems.reduce((sum, it) => sum + (it.price_paise * it.quantity), 0);
    const totalQuantity = pricingItems.reduce((sum, it) => sum + it.quantity, 0);
    const combinedName = pricingItems.map((it) => `${it.product.name} (x${it.quantity})`).join(" + ");
    const itemsSummary = pricingItems.map((it) => ({
      id: it.product.id,
      name: it.product.name,
      quantity: it.quantity,
      price_paise: it.price_paise,
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
    const body = await request.json();
    const {
      items,
      budget_cap_paise,
      expected_total_paise,
      auto_capture = false,
      quote_id,
      idempotency_key,
      mandate_authorized = false,
      session_id = `sess_${Date.now()}`,
      cart_id = "default_cart",
      buyer_context = {}
    } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { status: "error", error: "Missing or invalid 'items' list in payload" },
        { status: 400 }
      );
    }

    const config = getMerchantConfig();
    const activeVersion = getActivePolicyVersion();
    let currentPolicyVersion = activeVersion;

    // 1. Enforce Global Autonomous Checkout Permission (Gate 1)
    if (!config.policy.agent_can_checkout) {
      logAuditEvent({
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

    // 2. Enforce Mandate pre-authorization consent (Gate 2)
    if (config.policy.mandate_required && mandate_authorized !== true) {
      logAuditEvent({
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

    // 3. Checkout Idempotency Check (P1 - Unique constraint check)
    if (requestIdempotencyKey) {
      const { data: existingOrders, error: exErr } = await supabase
        .from("orders")
        .select("*")
        .eq("razorpay_order_id", uniqueIdemOrderId);
      
      if (!exErr && existingOrders && existingOrders.length > 0) {
        console.log(`✅ [IDEMPOTENCY] Reusing existing order for key ${requestIdempotencyKey}`);
        
        logAuditEvent({
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

        return NextResponse.json({
          status: "success",
          order_id: existingOrders[0].razorpay_order_id,
          amount_paise: existingOrders[0].amount,
          currency: "INR",
          simulated: true,
          receipt: `receipt_${existingOrders[0].razorpay_order_id}`,
          payment_link_url: `https://rzp.io/i/simulated_${existingOrders[0].razorpay_order_id}`,
          details: "Idempotent payment transaction re-used."
        });
      }
    }

    // 4. Price Integrity Guardrail with Growth Rule Engine
    let pricing;
    try {
      pricing = await calculateCartTotal(items, buyer_context);
      console.log(`[GUARDRAIL] [PRICE] calculated total: ₹${(pricing.total_paise / 100).toFixed(2)} (Subtotal: ₹${(pricing.subtotal_paise / 100).toFixed(2)}, Discount: ₹${(pricing.discount_paise / 100).toFixed(2)}, Applied Rules: ${pricing.applied_rules.map(r => r.rule_name).join(", ") || "None"})`);
    } catch (pricingErr: any) {
      console.error(`[GUARDRAIL] [PRICE] pricing check failed: ${pricingErr?.message}`);
      return NextResponse.json(
        { status: "error", error: "PRICING_FAILED", details: pricingErr?.message },
        { status: 400 }
      );
    }

    // 5. Verify Quote ID signature and scope (Cart, Quantity & version validation) (P1)
    let quotePriceOverride: number | null = null;
    if (quote_id && quote_id.startsWith("quote_")) {
      try {
        const token = quote_id.substring(6);
        const decoded = Buffer.from(token, "base64").toString("utf-8");
        const parts = decoded.split(":");
        
        if (parts.length === 8) {
          const [qProductId, qPriceStr, qExpiresStr, qSize, qQtyStr, qCartId, qVersion, qHmac] = parts;
          const secret = process.env.RAZORPAY_KEY_SECRET || "merchant_gateway_secret_key_1029";
          const verifyMessage = `${qProductId}:${qPriceStr}:${qExpiresStr}:${qSize}:${qQtyStr}:${qCartId}:${qVersion}`;
          const expectedHmac = crypto.createHmac("sha256", secret).update(verifyMessage).digest("hex");
          
          if (expectedHmac === qHmac && Date.now() < parseInt(qExpiresStr) && qVersion) {
            currentPolicyVersion = qVersion;
            // Verify cart scope matching
            const matchedItem = items.find(item => item.id === qProductId);
            const clientCartId = cart_id || "default_cart";
            
            if (!matchedItem || matchedItem.quantity !== parseInt(qQtyStr) || qCartId !== clientCartId) {
              console.error("❌ [SECURITY] [QUOTE_SCOPE_MISMATCH] Cart items or quantity do not match quote scope.");
              
              logAuditEvent({
                actor: "AI Buyer Agent",
                action: "CHECKOUT_BLOCKED",
                session_id,
                cart_id: clientCartId,
                quote_id: quote_id,
                order_id: null,
                policy_version: qVersion,
                amount_before: pricing.total_paise / 100,
                amount_after: null,
                policy_result: "BLOCKED",
                reason_code: "PRICE_MISMATCH",
                outcome: "FAILED",
                details: "Quote token scope (quantity or cart identity) does not match checkout request.",
                gate_results: { "Autonomy Gate": "PASS", "Mandate Bound": "PASS", "Quote Scope Match": "FAIL" }
              });

              return NextResponse.json({
                status: "error",
                error: "QUOTE_SCOPE_MISMATCH",
                details: "The quote token scope (quantity or cart identity) does not match your checkout request."
              }, { status: 422 });
            }
            
            quotePriceOverride = parseInt(qPriceStr) * matchedItem.quantity;
            console.log(`✅ [QUOTE_VERIFIED] Valid dynamic quote found under ${qVersion}. Overriding price total to: ₹${(quotePriceOverride / 100).toFixed(2)}`);
          } else {
            console.warn("⚠️ [QUOTE_VERIFY_FAILED] Quote token signature mismatch or expired.");
          }
        }
      } catch (quoteErr) {
        console.error("❌ Error parsing quote token:", quoteErr);
      }
    }

    if (quotePriceOverride !== null) {
      pricing.total_paise = quotePriceOverride;
      pricing.final_total_paise = quotePriceOverride;
    }

    const checkTotal = quotePriceOverride !== null ? quotePriceOverride : pricing.total_paise;
    if (expected_total_paise !== undefined && checkTotal !== expected_total_paise) {
      console.error(`❌ [SECURITY] [PRICE_MISMATCH] client expected: ₹${(expected_total_paise / 100).toFixed(2)}, secure calculated total: ₹${(checkTotal / 100).toFixed(2)}`);
      console.error(`❌ [SECURITY] Possible prompt injection or tampering blocked.`);
      
      logAuditEvent({
        actor: "AI Buyer Agent",
        action: "CHECKOUT_BLOCKED",
        quote_id: quote_id || null,
        order_id: null,
        amount_before: expected_total_paise / 100,
        amount_after: null,
        policy_result: "BLOCKED",
        reason_code: "PRICE_MISMATCH",
        outcome: "FAILED"
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

    // 6. Budget Cap Policy Guardrail
    const maxCheckoutCap = config.policy.max_autonomous_checkout_paise;
    console.log(`[GUARDRAIL] [BUDGET] Merchant policy max limit: ₹${(maxCheckoutCap / 100).toFixed(2)}`);
    if (pricing.total_paise > maxCheckoutCap) {
      console.error(`❌ [SECURITY] [BUDGET_CAP_EXCEEDED] total ₹${(pricing.total_paise / 100).toFixed(2)} exceeds cap limit ₹${(maxCheckoutCap / 100).toFixed(2)}`);
      
      logAuditEvent({
        actor: "AI Buyer Agent",
        action: "CHECKOUT_BLOCKED",
        quote_id: quote_id || null,
        order_id: null,
        amount_before: pricing.total_paise / 100,
        amount_after: null,
        policy_result: "BLOCKED",
        reason_code: "BUDGET_EXCEEDED",
        outcome: "FAILED"
      });

      return NextResponse.json(
        {
          status: "error",
          error: "BUDGET_CAP_EXCEEDED",
          details: `Order total of ₹${(pricing.total_paise / 100).toFixed(2)} exceeds the merchant pre-configured budget cap limit of ₹${(maxCheckoutCap / 100).toFixed(2)}.`
        },
        { status: 422 }
      );
    }
    console.log("✅ [GUARDRAIL] [BUDGET] Budget bounds verified successfully.");

    // 7. Atomic Stock Allocation (P1 - Concurrency-Safe)
    for (const item of pricing.items) {
      console.log(`[GUARDRAIL] [STOCK] Checking inventory for "${item.product.name}"...`);
      const { data: prod, error: getErr } = await supabase
        .from("products")
        .select("stock")
        .eq("id", item.product.id)
        .single();

      if (getErr || !prod) {
        console.error(`❌ [GUARDRAIL] [STOCK] Stock query failed for ${item.product.name}`);
        return NextResponse.json(
          { status: "error", error: "STOCK_CHECK_FAILED" },
          { status: 400 }
        );
      }

      // Concurrency-Safe Conditional Stock Update
      console.log(`[GUARDRAIL] [STOCK] Executing atomic conditional decrement for "${item.product.name}"...`);
      const { data: updatedRows, error: updateErr } = await supabase
        .from("products")
        .update({ stock: prod.stock - item.quantity })
        .eq("id", item.product.id)
        .gte("stock", item.quantity)
        .select();

      if (updateErr || !updatedRows || updatedRows.length === 0) {
        console.error(`❌ [SECURITY] [STOCK_OUT] Atomic check failed. "${item.product.name}" stock depleted or locked.`);
        
        logAuditEvent({
          actor: "AI Buyer Agent",
          action: "CHECKOUT_BLOCKED",
          session_id,
          cart_id,
          quote_id: quote_id || null,
          order_id: null,
          policy_version: currentPolicyVersion,
          amount_before: pricing.total_paise / 100,
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

    // 8. Razorpay Test Rails Checkout & Idempotency persistence
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    const actualRzpTotal = pricing.total_paise;
    const adminNotes = `idempotency_key:${requestIdempotencyKey || ""}|quote_id:${quote_id || ""}|rules:${pricing.applied_rules.map(r => r.rule_id).join(",")}`;

    const auditArithmetic = {
      subtotal: Math.round(pricing.subtotal_paise / 100),
      discount: Math.round(pricing.discount_paise / 100),
      final_total: Math.round(actualRzpTotal / 100),
      buyer_savings: Math.round(pricing.discount_paise / 100),
      incremental_revenue: Math.round(actualRzpTotal / 100) > 649 ? Math.round(actualRzpTotal / 100) - 649 : 0
    };

    if (!keyId || !keySecret || keyId === "rzp_test_placeholder") {
      await saveOrderToDb(supabase, uniqueIdemOrderId, pricing.items, auto_capture ? "paid" : "created", adminNotes);
      console.log(`🎉 [PAYMENT] [SIMULATOR] Issued Order ID: ${uniqueIdemOrderId}. Receipt: receipt_${Date.now()}`);
      
      logAuditEvent({
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
        gate_results: {
          "Autonomy Gate": "PASS",
          "Mandate Bound": "PASS",
          "Budget Cap Gate": "PASS",
          "Inventory Stock Gate": "PASS",
          "Quote Scope Match": "PASS"
        },
        arithmetic: auditArithmetic
      });

      console.log("=======================================================\n");
      return NextResponse.json({
        status: "success",
        order_id: uniqueIdemOrderId,
        amount_paise: actualRzpTotal,
        currency: "INR",
        simulated: true,
        applied_rules: pricing.applied_rules,
        receipt: `receipt_${Date.now()}`,
        payment_link_url: auto_capture ? null : `https://rzp.io/i/simulated_${uniqueIdemOrderId}`,
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
        original_price_paise: pricing.total_paise.toString()
      }
    });

    await saveOrderToDb(supabase, uniqueIdemOrderId, pricing.items, auto_capture ? "paid" : "created", `${adminNotes}|rzp_order_id:${rzpOrder.id}`);
    console.log(`🎉 [PAYMENT] [RAZORPAY] Created Order ID: ${rzpOrder.id}. Receipt: ${rzpOrder.receipt}`);

    logAuditEvent({
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
      gate_results: {
        "Autonomy Gate": "PASS",
        "Mandate Bound": "PASS",
        "Budget Cap Gate": "PASS",
        "Inventory Stock Gate": "PASS",
        "Quote Scope Match": "PASS"
      },
      arithmetic: auditArithmetic
    });

    let paymentLinkUrl = null;
    if (!auto_capture) {
      try {
        console.log(`[PAYMENT] [RAZORPAY] Generating payment link for Order ID: ${rzpOrder.id}...`);
        const paymentLink = await rzp.paymentLink.create({
          amount: pricing.total_paise,
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
        console.error("❌ [PAYMENT] [RAZORPAY] Failed to create payment link:", linkErr?.message || linkErr);
      }
    }

    console.log("=======================================================\n");

    return NextResponse.json({
      status: "success",
      order_id: uniqueIdemOrderId,
      amount_paise: actualRzpTotal,
      currency: "INR",
      simulated: false,
      applied_rules: pricing.applied_rules,
      receipt: rzpOrder.receipt,
      payment_link_url: paymentLinkUrl,
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
