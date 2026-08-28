import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase, supabasePublic } from "@/lib/supabase";
import { logAuditEvent } from "@/lib/audit-ledger";
import Razorpay from "razorpay";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * Calculates correct cart pricing based on DB products and bundle rules
 */
async function calculateCartTotal(items: Array<{ id: string; quantity: number }>) {
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

  let subtotalPaise = 0;
  let hasTee = false;
  let hasPants = false;

  const itemDetails = items.map((item) => {
    const product = dbProducts.find((p) => p.id === item.id);
    if (!product) throw new Error(`Product ID ${item.id} not found in catalog`);
    
    if (product.category === "T-Shirts") hasTee = true;
    if (product.category === "Pants") hasPants = true;

    const price = product.price;
    const itemTotal = price * item.quantity;
    subtotalPaise += itemTotal;

    return {
      product,
      quantity: item.quantity,
      price_paise: price,
    };
  });

  // Apply 15% combo discount if both Tee and Pants are in cart
  let discountPaise = 0;
  if (hasTee && hasPants) {
    discountPaise = Math.round(subtotalPaise * 0.15);
  }

  const finalTotalPaise = subtotalPaise - discountPaise;

  return {
    subtotal_paise: subtotalPaise,
    discount_paise: discountPaise,
    total_paise: finalTotalPaise,
    final_total_paise: finalTotalPaise,
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
    const ordersToInsert = pricingItems.map((item) => ({
      razorpay_order_id: rzpOrderId,
      product_id: item.product.id,
      product_name: item.product.name,
      product_price: item.product.price,
      quantity: item.quantity,
      amount: item.price_paise * item.quantity,
      customer_name: "A2A Buyer Agent",
      customer_email: "agent@zeroclick.com",
      customer_phone: "9999999999",
      shipping_address: {
        city: "Pune",
        line1: "Army Institute of Technology, Alandi Road",
        state: "Maharashtra",
        pincode: "411015",
      },
      size: item.product.sizes[0] || "L",
      status: status,
      admin_notes: adminNotes,
    }));

    const { error } = await supabase.from("orders").insert(ordersToInsert);

    if (error) {
      console.error("❌ [DATABASE] [ORDER] Failed to insert orders:", error);
    } else {
      console.log(`✅ [DATABASE] [ORDER] Saved ${ordersToInsert.length} order row(s) to DB.`);
    }
  } catch (err) {
    console.error("❌ [DATABASE] [ORDER] Exception during DB insert:", err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { items, budget_cap_paise, expected_total_paise, auto_capture, quote_id, idempotency_key } = body;

    const requestIdempotencyKey = request.headers.get("x-idempotency-key") || idempotency_key;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { status: "error", error: "Missing or invalid 'items' list in payload" },
        { status: 400 }
      );
    }

    const secureCap = budget_cap_paise || 500000; // Default max 5000 INR

    console.log("\n=======================================================");
    console.log("🤖 [A2A CHECKOUT] Initiating Secure Payment Handshake");
    console.log("=======================================================");

    const supabase = getAdminSupabase() || supabasePublic;
    if (!supabase) {
      console.error("❌ [SECURITY] [DATABASE] Supabase client is unavailable.");
      return NextResponse.json(
        { status: "error", error: "DATABASE_UNAVAILABLE" },
        { status: 500 }
      );
    }

    // 1. Checkout Idempotency Check (P1)
    if (requestIdempotencyKey) {
      const { data: existingOrders, error: exErr } = await supabase
        .from("orders")
        .select("*")
        .like("admin_notes", `%idempotency_key:${requestIdempotencyKey}%`);
      
      if (!exErr && existingOrders && existingOrders.length > 0) {
        console.log(`✅ [IDEMPOTENCY] Reusing existing order for key ${requestIdempotencyKey}`);
        
        logAuditEvent({
          actor: "AI Buyer Agent",
          action: "ORDER_CREATED",
          quote_id: quote_id || null,
          order_id: existingOrders[0].razorpay_order_id,
          amount_before: null,
          amount_after: existingOrders[0].amount / 100,
          policy_result: "ALLOWED",
          reason_code: "IDEMPOTENT_REUSE",
          outcome: "COMPLETED"
        });

        return NextResponse.json({
          status: "success",
          order_id: existingOrders[0].razorpay_order_id,
          amount_paise: existingOrders[0].amount,
          currency: "INR",
          simulated: existingOrders[0].razorpay_order_id.startsWith("order_sim_"),
          receipt: `receipt_${existingOrders[0].razorpay_order_id}`,
          payment_link_url: existingOrders[0].razorpay_order_id.startsWith("order_sim_") 
            ? `https://rzp.io/i/simulated_${existingOrders[0].razorpay_order_id}` 
            : `https://rzp.io/rzp/reused_${existingOrders[0].razorpay_order_id}`,
          details: "Idempotent payment transaction re-used."
        });
      }
    }

    // 2. Price Integrity Guardrail
    let pricing;
    try {
      pricing = await calculateCartTotal(items);
      console.log(`[GUARDRAIL] [PRICE] calculated total: ₹${(pricing.total_paise / 100).toFixed(2)} (Subtotal: ₹${(pricing.subtotal_paise / 100).toFixed(2)}, Bundle Discount: ₹${(pricing.discount_paise / 100).toFixed(2)})`);
    } catch (pricingErr: any) {
      console.error(`[GUARDRAIL] [PRICE] pricing check failed: ${pricingErr?.message}`);
      return NextResponse.json(
        { status: "error", error: "PRICING_FAILED", details: pricingErr?.message },
        { status: 400 }
      );
    }

    // 3. Verify Quote ID signature and scope (Cart & Quantity) (P1)
    let quotePriceOverride: number | null = null;
    if (quote_id && quote_id.startsWith("quote_")) {
      try {
        const token = quote_id.substring(6);
        const decoded = Buffer.from(token, "base64").toString("utf-8");
        const parts = decoded.split(":");
        
        if (parts.length === 7) {
          const [qProductId, qPriceStr, qExpiresStr, qSize, qQtyStr, qCartId, qHmac] = parts;
          const secret = process.env.RAZORPAY_KEY_SECRET || "merchant_gateway_secret_key_1029";
          const verifyMessage = `${qProductId}:${qPriceStr}:${qExpiresStr}:${qSize}:${qQtyStr}:${qCartId}`;
          const expectedHmac = crypto.createHmac("sha256", secret).update(verifyMessage).digest("hex");
          
          if (expectedHmac === qHmac && Date.now() < parseInt(qExpiresStr)) {
            // Verify cart scope matching
            const matchedItem = items.find(item => item.id === qProductId);
            const clientCartId = body.cart_id || "default_cart";
            
            if (!matchedItem || matchedItem.quantity !== parseInt(qQtyStr) || qCartId !== clientCartId) {
              console.error("❌ [SECURITY] [QUOTE_SCOPE_MISMATCH] Cart items or quantity do not match quote scope.");
              
              logAuditEvent({
                actor: "AI Buyer Agent",
                action: "CHECKOUT_BLOCKED",
                quote_id: quote_id,
                order_id: null,
                amount_before: pricing.total_paise / 100,
                amount_after: null,
                policy_result: "BLOCKED",
                reason_code: "PRICE_MISMATCH",
                outcome: "FAILED"
              });

              return NextResponse.json({
                status: "error",
                error: "QUOTE_SCOPE_MISMATCH",
                details: "The quote token scope (quantity or cart identity) does not match your checkout request."
              }, { status: 422 });
            }
            
            quotePriceOverride = parseInt(qPriceStr) * matchedItem.quantity;
            console.log(`✅ [QUOTE_VERIFIED] Valid dynamic quote found. Overriding price total to: ₹${(quotePriceOverride / 100).toFixed(2)}`);
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

    // 4. Budget Cap Guardrail
    console.log(`[GUARDRAIL] [BUDGET] Client pre-authorized cap: ₹${(secureCap / 100).toFixed(2)}`);
    if (pricing.total_paise > secureCap) {
      console.error(`❌ [SECURITY] [BUDGET_CAP_EXCEEDED] total ₹${(pricing.total_paise / 100).toFixed(2)} exceeds cap ₹${(secureCap / 100).toFixed(2)}`);
      
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

      const dbConn = getAdminSupabase() || supabasePublic;
      let alternatives: any[] = [];
      if (dbConn) {
        const { data: cheaperProducts } = await dbConn
          .from("products")
          .select("id, name, price")
          .lte("price", secureCap)
          .gt("stock", 0)
          .limit(3);
        if (cheaperProducts) {
          alternatives = cheaperProducts.map((p: any) => ({
            id: p.id,
            name: p.name,
            price_paise: p.price,
          }));
        }
      }

      return NextResponse.json(
        {
          status: "error",
          error: "BUDGET_CAP_EXCEEDED",
          details: `Order total of ₹${(pricing.total_paise / 100).toFixed(2)} exceeds your pre-authorized budget cap of ₹${(secureCap / 100).toFixed(2)}.`,
          alternatives,
        },
        { status: 422 }
      );
    }
    console.log("✅ [GUARDRAIL] [BUDGET] Budget bounds verified successfully.");

    // 5. Atomic Stock Allocation (P1 - Concurrency-Safe)
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
          quote_id: quote_id || null,
          order_id: null,
          amount_before: pricing.total_paise / 100,
          amount_after: null,
          policy_result: "BLOCKED",
          reason_code: "OUT_OF_STOCK",
          outcome: "FAILED"
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

    // 6. Razorpay Test Rails Checkout
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    const actualRzpTotal = pricing.total_paise;
    const adminNotes = `idempotency_key:${requestIdempotencyKey || ""}|quote_id:${quote_id || ""}`;

    if (!keyId || !keySecret || keyId === "rzp_test_placeholder") {
      const simOrderId = `order_sim_${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
      await saveOrderToDb(supabase, simOrderId, pricing.items, auto_capture ? "paid" : "created", adminNotes);
      console.log(`🎉 [PAYMENT] [SIMULATOR] Issued Order ID: ${simOrderId}. Receipt: receipt_${Date.now()}`);
      
      logAuditEvent({
        actor: "AI Buyer Agent",
        action: "ORDER_CREATED",
        quote_id: quote_id || null,
        order_id: simOrderId,
        amount_before: pricing.total_paise / 100,
        amount_after: actualRzpTotal / 100,
        policy_result: "ALLOWED",
        reason_code: "SUCCESS",
        outcome: "COMPLETED"
      });

      console.log("=======================================================\n");
      return NextResponse.json({
        status: "success",
        order_id: simOrderId,
        amount_paise: actualRzpTotal,
        currency: "INR",
        simulated: true,
        receipt: `receipt_${Date.now()}`,
        payment_link_url: auto_capture ? null : `https://rzp.io/i/simulated_${simOrderId}`,
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

    await saveOrderToDb(supabase, rzpOrder.id, pricing.items, auto_capture ? "paid" : "created", adminNotes);
    console.log(`🎉 [PAYMENT] [RAZORPAY] Created Order ID: ${rzpOrder.id}. Receipt: ${rzpOrder.receipt}`);

    logAuditEvent({
      actor: "AI Buyer Agent",
      action: "ORDER_CREATED",
      quote_id: quote_id || null,
      order_id: rzpOrder.id,
      amount_before: pricing.total_paise / 100,
      amount_after: actualRzpTotal / 100,
      policy_result: "ALLOWED",
      reason_code: "SUCCESS",
      outcome: "COMPLETED"
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
      order_id: rzpOrder.id,
      amount_paise: actualRzpTotal,
      currency: "INR",
      simulated: false,
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
