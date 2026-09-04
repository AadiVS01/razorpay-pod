import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase, supabasePublic } from "@/lib/supabase";
import { appendAuditEvent } from "@/lib/audit-ledger";

export const dynamic = "force-dynamic";

/**
 * Reconciles orphan orders or missing trust ledger audit events
 */
export async function POST(request: NextRequest) {
  try {
    let body: any = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is allowed, will reconcile recent orders
    }

    const { order_id } = body;
    const supabase = getAdminSupabase() || supabasePublic;
    if (!supabase) {
      return NextResponse.json(
        { status: "error", error: "DATABASE_UNAVAILABLE" },
        { status: 500 }
      );
    }

    // 1. Fetch target orders
    let query = supabase.from("orders").select("*").order("created_at", { ascending: false }).limit(50);
    if (order_id) {
      query = supabase.from("orders").select("*").eq("razorpay_order_id", order_id);
    }

    const { data: dbOrders, error: orderErr } = await query;
    if (orderErr || !dbOrders) {
      return NextResponse.json(
        { status: "error", error: "ORDERS_FETCH_FAILED", details: orderErr?.message },
        { status: 500 }
      );
    }

    // 2. Fetch existing ledger events for these order IDs
    const orderIds = Array.from(new Set(dbOrders.map(o => o.razorpay_order_id)));
    const { data: existingEvents } = await supabase
      .from("trust_ledger_events")
      .select("order_id")
      .in("order_id", orderIds);

    const existingOrderSet = new Set((existingEvents || []).map((e: any) => e.order_id));

    // 3. Identify and reconcile orphan orders
    const reconciled: string[] = [];
    const groupedByOrderId = new Map<string, any[]>();
    for (const ord of dbOrders) {
      if (!groupedByOrderId.has(ord.razorpay_order_id)) {
        groupedByOrderId.set(ord.razorpay_order_id, []);
      }
      groupedByOrderId.get(ord.razorpay_order_id)!.push(ord);
    }

    for (const [id, rows] of groupedByOrderId.entries()) {
      if (!existingOrderSet.has(id)) {
        const firstRow = rows[0];
        const totalAmountPaise = rows.reduce((sum, r) => sum + (r.amount || 0), 0);
        const amountInr = Math.round(totalAmountPaise / 100);

        await appendAuditEvent({
          event_id: `reconciled_${id}_${Date.now()}`,
          actor: "Gateway",
          action: "ORDER_CREATED",
          order_id: id,
          session_id: `sess_reconciled_${id}`,
          policy_version: "v1",
          amount_before: amountInr,
          amount_after: amountInr,
          policy_result: "ALLOWED",
          reason_code: "SUCCESS",
          outcome: firstRow.status === "failed" ? "FAILED" : "COMPLETED",
          details: `Reconciled orphan order record ${id}. Items: ${rows.map(r => r.product_name).join(", ")}.`,
          gate_results: {
            "Autonomy Gate": "PASS",
            "Mandate Bound": "PASS",
            "Budget Cap Gate": "PASS",
            "Inventory Stock Gate": "PASS"
          }
        });
        reconciled.push(id);
      }
    }

    return NextResponse.json({
      status: "success",
      reconciled_count: reconciled.length,
      reconciled_orders: reconciled,
      checked_orders_count: orderIds.length
    }, { status: 200 });

  } catch (err: any) {
    console.error("Reconciliation error:", err);
    return NextResponse.json(
      { status: "error", error: "RECONCILE_FAILED", details: err?.message },
      { status: 500 }
    );
  }
}
