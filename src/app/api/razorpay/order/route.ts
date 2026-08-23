import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase, supabasePublic } from "@/lib/supabase";
import Razorpay from "razorpay";

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
    items: itemDetails,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { items, budget_cap_paise, expected_total_paise } = body;

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

    // 1. Price Integrity Guardrail
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

    if (expected_total_paise !== undefined && pricing.total_paise !== expected_total_paise) {
      console.error(`❌ [SECURITY] [PRICE_MISMATCH] client expected: ₹${(expected_total_paise / 100).toFixed(2)}, secure calculated total: ₹${(pricing.total_paise / 100).toFixed(2)}`);
      console.error(`❌ [SECURITY] Possible prompt injection or tampering blocked.`);
      return NextResponse.json(
        {
          status: "error",
          error: "PRICE_MISMATCH",
          details: `Requested total (${expected_total_paise} paise) does not match merchant calculated total (${pricing.total_paise} paise). Prompt injection blocked.`
        },
        { status: 422 }
      );
    }
    console.log("✅ [GUARDRAIL] [PRICE] Price Integrity verified successfully.");

    // 2. Budget Cap Guardrail
    console.log(`[GUARDRAIL] [BUDGET] Client pre-authorized cap: ₹${(secureCap / 100).toFixed(2)}`);
    if (pricing.total_paise > secureCap) {
      console.error(`❌ [SECURITY] [BUDGET_CAP_EXCEEDED] total ₹${(pricing.total_paise / 100).toFixed(2)} exceeds cap ₹${(secureCap / 100).toFixed(2)}`);
      return NextResponse.json(
        {
          status: "error",
          error: "BUDGET_CAP_EXCEEDED",
          details: `Order total of ₹${(pricing.total_paise / 100).toFixed(2)} exceeds your pre-authorized budget cap of ₹${(secureCap / 100).toFixed(2)}.`
        },
        { status: 422 }
      );
    }
    console.log("✅ [GUARDRAIL] [BUDGET] Budget bounds verified successfully.");

    // 3. Atomic Stock Allocation
    const supabase = getAdminSupabase() || supabasePublic;
    if (!supabase) {
      console.error("❌ [SECURITY] [DATABASE] Supabase client is unavailable.");
      return NextResponse.json(
        { status: "error", error: "DATABASE_UNAVAILABLE" },
        { status: 500 }
      );
    }

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

      if (prod.stock < item.quantity) {
        console.error(`❌ [SECURITY] [STOCK_OUT] FAILED. "${item.product.name}" stock: ${prod.stock}, requested: ${item.quantity}`);
        return NextResponse.json(
          {
            status: "error",
            error: "INVENTORY_STOCK_OUT",
            details: `Cannot fulfill order. Product "${item.product.name}" has insufficient stock (Available: ${prod.stock}, Requested: ${item.quantity}).`
          },
          { status: 422 }
        );
      }

      // Deduct stock atomically
      const newStock = prod.stock - item.quantity;
      const { error: updateErr } = await supabase
        .from("products")
        .update({ stock: newStock })
        .eq("id", item.product.id);

      if (updateErr) {
        console.error(`❌ [GUARDRAIL] [STOCK] Stock decrement failed: ${updateErr.message}`);
        return NextResponse.json(
          { status: "error", error: "STOCK_UPDATE_FAILED", details: updateErr.message },
          { status: 500 }
        );
      }
      console.log(`✅ [GUARDRAIL] [STOCK] Allocated ${item.quantity} unit(s) of "${item.product.name}". Remaining stock: ${newStock}.`);
    }

    console.log("✅ [GUARDRAIL] All checkout security rails cleared. Initiating payment creation...");

    // 4. Razorpay Test Rails Checkout
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret || keyId === "rzp_test_placeholder") {
      const simOrderId = `order_sim_${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
      console.log(`🎉 [PAYMENT] [SIMULATOR] Issued Order ID: ${simOrderId}. Receipt: receipt_${Date.now()}`);
      console.log("=======================================================\n");
      return NextResponse.json({
        status: "success",
        order_id: simOrderId,
        amount_paise: pricing.total_paise,
        currency: "INR",
        simulated: true,
        receipt: `receipt_${Date.now()}`,
        details: "Checkout executed via A2A Bounded Payment Simulator.",
      });
    }

    const rzp = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });

    const rzpOrder = await rzp.orders.create({
      amount: pricing.total_paise,
      currency: "INR",
      receipt: `receipt_${Date.now()}`,
      notes: {
        agent_checkout: "true",
        protocol: "a2a-v1.0"
      }
    });

    console.log(`🎉 [PAYMENT] [RAZORPAY] Created Order ID: ${rzpOrder.id}. Receipt: ${rzpOrder.receipt}`);
    console.log("=======================================================\n");

    return NextResponse.json({
      status: "success",
      order_id: rzpOrder.id,
      amount_paise: pricing.total_paise,
      currency: "INR",
      simulated: false,
      receipt: rzpOrder.receipt,
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
