import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase, supabasePublic } from "@/lib/supabase";
import { appendAuditEvent } from "@/lib/audit-ledger";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-razorpay-signature");
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    // Optional signature verification if secret is configured
    if (webhookSecret && signature) {
      const expectedSignature = crypto
        .createHmac("sha256", webhookSecret)
        .update(rawBody)
        .digest("hex");

      if (expectedSignature !== signature) {
        console.warn("⚠️ [WEBHOOK] [RAZORPAY] Invalid webhook signature.");
        return NextResponse.json({ status: "error", error: "INVALID_SIGNATURE" }, { status: 400 });
      }
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ status: "error", error: "INVALID_JSON" }, { status: 400 });
    }

    const event = payload.event;
    console.log(`🔔 [WEBHOOK] [RAZORPAY] Received event: ${event}`);

    if (event === "payment.captured" || event === "order.paid") {
      const paymentEntity = payload.payload?.payment?.entity;
      const orderEntity = payload.payload?.order?.entity;
      const rzpOrderId = paymentEntity?.order_id || orderEntity?.id;
      const amountPaise = paymentEntity?.amount || orderEntity?.amount || 0;
      const amountInr = Math.round(amountPaise / 100);

      const supabase = getAdminSupabase() || supabasePublic;
      if (supabase && rzpOrderId) {
        // Find matching orders
        const { data: orders } = await supabase
          .from("orders")
          .select("*")
          .or(`razorpay_order_id.eq.${rzpOrderId},admin_notes.ilike.%rzp_order_id:${rzpOrderId}%`);

        if (orders && orders.length > 0) {
          for (const order of orders) {
            await supabase
              .from("orders")
              .update({ status: "paid" })
              .eq("id", order.id);
          }
        }

        // Log PAYMENT_CAPTURED to Trust Ledger
        await appendAuditEvent({
          actor: "Gateway",
          action: "PAYMENT_CAPTURED",
          order_id: rzpOrderId,
          policy_result: "ALLOWED",
          reason_code: "SUCCESS",
          outcome: "COMPLETED",
          amount_before: amountInr,
          amount_after: amountInr,
          details: `Webhook event "${event}" received. Payment captured on Razorpay for ₹${amountInr}.`
        });

        console.log(`✅ [WEBHOOK] [RAZORPAY] Successfully processed payment capture for ${rzpOrderId}`);
      }
    }

    return NextResponse.json({ status: "success", received: true }, { status: 200 });

  } catch (err: any) {
    console.error("❌ [WEBHOOK] [RAZORPAY] Webhook processing exception:", err);
    return NextResponse.json({ status: "error", error: err?.message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Razorpay-Signature",
    },
  });
}
