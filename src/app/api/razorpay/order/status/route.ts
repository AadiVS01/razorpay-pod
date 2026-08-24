import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase, supabasePublic } from "@/lib/supabase";

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

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
