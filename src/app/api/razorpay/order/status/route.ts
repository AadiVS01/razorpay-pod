import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase, supabasePublic } from "@/lib/supabase";
import { logAuditEvent } from "@/lib/audit-ledger";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get("order_id");

    if (!orderId) {
      return NextResponse.json(
        { status: "error", error: "MISSING_ORDER_ID", details: "Query parameter 'order_id' is required." },
        { status: 400 }
      );
    }

    const supabase = getAdminSupabase() || supabasePublic;
    if (!supabase) {
      return NextResponse.json(
        { status: "error", error: "DATABASE_UNAVAILABLE" },
        { status: 500 }
      );
    }

    // Query order rows matching the razorpay_order_id
    const { data: orders, error } = await supabase
      .from("orders")
      .select("razorpay_order_id, status, product_name, amount, created_at")
      .eq("razorpay_order_id", orderId);

    if (error || !orders || orders.length === 0) {
      return NextResponse.json(
        { status: "error", error: "ORDER_NOT_FOUND", details: `No orders found matching ID ${orderId}` },
        { status: 404 }
      );
    }

    // Consolidate status (if multiple items, check if any is paid/created)
    const orderStatus = orders[0].status;
    const totalAmountPaise = orders.reduce((sum: number, item: any) => sum + item.amount, 0);

    console.log(`🔍 [STATUS] Querying transaction status for order ${orderId}. Current status: ${orderStatus}`);

    return NextResponse.json({
      status: "success",
      order_id: orderId,
      payment_status: orderStatus, // "created", "paid", etc.
      total_amount_paise: totalAmountPaise,
      currency: "INR",
      items_count: orders.length,
      updated_at: orders[0].created_at || new Date().toISOString(),
    }, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      }
    });

  } catch (err: any) {
    console.error("Order Status API error:", err);
    return NextResponse.json(
      { status: "error", error: "STATUS_INTERNAL_ERROR", details: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { order_id, status } = body;

    if (!order_id || status !== "failed") {
      return NextResponse.json(
        { status: "error", error: "INVALID_REQUEST", details: "Required: order_id, status: 'failed'" },
        { status: 400 }
      );
    }

    const supabase = getAdminSupabase() || supabasePublic;
    if (!supabase) {
      return NextResponse.json(
        { status: "error", error: "DATABASE_UNAVAILABLE" },
        { status: 500 }
      );
    }

    // Query order rows to verify if it can be failed
    const { data: orders, error: getErr } = await supabase
      .from("orders")
      .select("*")
      .eq("razorpay_order_id", order_id);

    if (getErr || !orders || orders.length === 0) {
      return NextResponse.json(
        { status: "error", error: "ORDER_NOT_FOUND" },
        { status: 404 }
      );
    }

    const currentStatus = orders[0].status;
    if (currentStatus === "failed") {
      return NextResponse.json(
        { status: "success", message: "Order is already failed. Stock already restored.", already_failed: true },
        { status: 200 }
      );
    }

    // Restore stock for all items in the order
    for (const orderRow of orders) {
      let itemsToRestore = [{ product_id: orderRow.product_id, product_name: orderRow.product_name, quantity: orderRow.quantity }];
      if (orderRow.admin_notes && orderRow.admin_notes.includes("items_json:")) {
        try {
          const match = orderRow.admin_notes.match(/items_json:(.+)$/);
          if (match && match[1]) {
            const parsed = JSON.parse(match[1]);
            if (Array.isArray(parsed) && parsed.length > 0) {
              itemsToRestore = parsed.map((it: any) => ({
                product_id: it.id,
                product_name: it.name,
                quantity: it.quantity
              }));
            }
          }
        } catch (e) {
          console.warn("Could not parse items_json from admin_notes:", e);
        }
      }

      for (const item of itemsToRestore) {
        const { data: prod } = await supabase
          .from("products")
          .select("stock")
          .eq("id", item.product_id)
          .single();
        
        if (prod) {
          const restoredStock = prod.stock + item.quantity;
          await supabase
            .from("products")
            .update({ stock: restoredStock })
            .eq("id", item.product_id);
          console.log(`[STATUS] Restored stock for ${item.product_name}: +${item.quantity} units. New stock: ${restoredStock}`);
        }
      }
    }

    // Update order status to failed
    await supabase
      .from("orders")
      .update({ status: "failed" })
      .eq("razorpay_order_id", order_id);

    // Log event to Trust Ledger
    logAuditEvent({
      actor: "Gateway",
      action: "STOCK_RESTORATION",
      quote_id: null,
      order_id: order_id,
      amount_before: null,
      amount_after: null,
      policy_result: "ALLOWED",
      reason_code: "SUCCESS" as any,
      outcome: "FAILED"
    });

    return NextResponse.json({
      status: "success",
      message: "Order marked failed. Inventory successfully restored exactly once.",
      order_id
    }, { status: 200 });

  } catch (err: any) {
    return NextResponse.json(
      { status: "error", error: "INTERNAL_ERROR", details: err?.message },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
