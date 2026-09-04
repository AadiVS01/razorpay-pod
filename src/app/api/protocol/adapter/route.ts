import { NextRequest, NextResponse } from "next/server";
import { getAgentCatalog } from "@/lib/catalog-service";
import { getMerchantConfig, getActivePolicyVersion } from "@/lib/merchant-config";
import { getAdminSupabase, supabasePublic } from "@/lib/supabase";
import { appendAuditEvent } from "@/lib/audit-ledger";
import crypto from "crypto";

export const dynamic = "force-dynamic";

type ProtocolType = "acp-shaped" | "ap2-shaped" | "x402-shaped";
type ActionType = "catalog" | "quote" | "checkout";

interface AdapterRequest {
  protocol: ProtocolType;
  action: ActionType;
  session_id?: string;
  cart_id?: string;
  payload?: any;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const protocol = (searchParams.get("protocol") || "acp-shaped") as ProtocolType;
    const action = (searchParams.get("action") || "catalog") as ActionType;

    const catalogData = await getAgentCatalog();
    const envelopeMeta = {
      "acp-shaped": {
        envelope_spec: "acp-agentic-commerce-draft",
        compatibility_layer: "protocol-shaped-adapter",
        capabilities: catalogData.merchant_capability_manifest
      },
      "ap2-shaped": {
        envelope_spec: "ap2-mandate-commerce",
        mandate_spec: "upi-uap-v1",
        capabilities: catalogData.merchant_capability_manifest
      },
      "x402-shaped": {
        envelope_spec: "x402-http-payment-required",
        settlement_rail: "razorpay_a2a_inr",
        capabilities: catalogData.merchant_capability_manifest
      }
    };

    return NextResponse.json({
      protocol,
      status: "success",
      envelope: envelopeMeta[protocol] || envelopeMeta["acp-shaped"],
      disclaimer: "Protocol-shaped demo envelope. Routes to authoritative ZeroClick catalog engine.",
      data: catalogData
    }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({
      status: "error",
      error: "ADAPTER_FAILURE",
      details: err?.message
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: AdapterRequest = await request.json();
    const {
      protocol = "acp-shaped",
      action = "catalog",
      session_id = `sess_adapter_${Date.now()}`,
      cart_id = "cart_adapter_default",
      payload = {}
    } = body;

    const activeVersion = getActivePolicyVersion();

    // 1. ACTION: CATALOG
    if (action === "catalog") {
      const catalogData = await getAgentCatalog(payload.filters);
      
      const envelopeMeta = {
        "acp-shaped": {
          envelope_spec: "acp-agentic-commerce-draft",
          compatibility_layer: "protocol-shaped-adapter",
          capabilities: catalogData.merchant_capability_manifest
        },
        "ap2-shaped": {
          envelope_spec: "ap2-mandate-commerce",
          mandate_spec: "upi-uap-v1",
          capabilities: catalogData.merchant_capability_manifest
        },
        "x402-shaped": {
          envelope_spec: "x402-http-payment-required",
          settlement_rail: "razorpay_a2a_inr",
          capabilities: catalogData.merchant_capability_manifest
        }
      };

      return NextResponse.json({
        protocol,
        status: "SUCCESS",
        envelope: envelopeMeta[protocol] || envelopeMeta["acp-shaped"],
        disclaimer: "Protocol-shaped demo envelope. Routes to authoritative ZeroClick catalog engine.",
        data: catalogData
      }, { status: 200 });
    }

    // 2. ACTION: QUOTE
    if (action === "quote") {
      const { product_id, bid_price_paise, size, quantity = 1 } = payload;
      if (!product_id || !bid_price_paise || !size) {
        return NextResponse.json({
          protocol,
          status: "ERROR",
          error: "MISSING_PARAMETERS",
          details: "Required in payload: product_id, bid_price_paise, size"
        }, { status: 400 });
      }

      const config = getMerchantConfig();

      if (!config.policy.agent_can_negotiate) {
        return NextResponse.json({
          protocol,
          status: "REJECTED",
          error: "NEGOTIATION_DISABLED",
          details: "Negotiation is disabled by merchant settings."
        }, { status: 422 });
      }

      const supabase = getAdminSupabase() || supabasePublic;
      if (!supabase) {
        return NextResponse.json({ protocol, status: "ERROR", error: "DATABASE_UNAVAILABLE" }, { status: 500 });
      }

      const { data: product, error: prodErr } = await supabase
        .from("products")
        .select("*")
        .eq("id", product_id)
        .single();

      if (prodErr || !product) {
        return NextResponse.json({ protocol, status: "ERROR", error: "PRODUCT_NOT_FOUND" }, { status: 404 });
      }

      const override = config.product_overrides[product_id];
      const maxDiscountPct = override ? override.max_discount_percent : 10;
      const minAcceptedPrice = Math.round(product.price * (1 - maxDiscountPct / 100));

      if (bid_price_paise < minAcceptedPrice) {
        return NextResponse.json({
          protocol,
          status: "REJECTED",
          error: "BID_TOO_LOW",
          details: `Bid ₹${bid_price_paise / 100} is below merchant minimum allowed price of ₹${minAcceptedPrice / 100}.`
        }, { status: 422 });
      }

      // Generate cryptographically signed quote token
      const secret = process.env.RAZORPAY_KEY_SECRET || "merchant_gateway_secret_key_1029";
      const expiresAt = Date.now() + (config.policy.quote_expiry_seconds * 1000);
      const message = `${product_id}:${bid_price_paise}:${expiresAt}:${size}:${quantity}:${cart_id}:${activeVersion}`;
      const hmac = crypto.createHmac("sha256", secret).update(message).digest("hex");
      const quoteId = `quote_${Buffer.from(`${message}:${hmac}`).toString("base64")}`;

      await appendAuditEvent({
        actor: "Merchant Revenue Agent",
        action: "QUOTE_ISSUED",
        session_id,
        cart_id,
        quote_id: quoteId,
        order_id: null,
        policy_version: activeVersion,
        amount_before: Math.round((product.price * quantity) / 100),
        amount_after: Math.round((bid_price_paise * quantity) / 100),
        policy_result: "ALLOWED",
        reason_code: "SUCCESS",
        outcome: "COMPLETED",
        details: `Generated protocol-shaped quote token (${protocol}) under policy ${activeVersion}.`
      });

      return NextResponse.json({
        protocol,
        status: "ACCEPTED",
        disclaimer: "Protocol-shaped quote envelope signed with HMAC and active policy snapshot.",
        data: {
          quote_id: quoteId,
          policy_version: activeVersion,
          product_id,
          agreed_price_paise: bid_price_paise,
          currency: "INR",
          expires_at: new Date(expiresAt).toISOString()
        }
      }, { status: 200 });
    }

    // 3. ACTION: CHECKOUT
    if (action === "checkout") {
      // Forward directly to authoritative order route logic via internal fetch
      const orderReqUrl = new URL("/api/razorpay/order", request.url);
      const orderRes = await fetch(orderReqUrl.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          session_id: payload.session_id || session_id,
          cart_id: payload.cart_id || cart_id
        })
      });

      const orderData = await orderRes.json();

      return NextResponse.json({
        protocol,
        status: orderRes.ok ? "SUCCESS" : "ERROR",
        http_status: orderRes.status,
        disclaimer: "Protocol-shaped checkout adapter. Executed on unified autonomous safety backbone.",
        response: orderData
      }, { status: orderRes.status });
    }

    return NextResponse.json({
      protocol,
      status: "ERROR",
      error: "INVALID_ACTION",
      details: `Action "${action}" is not supported. Valid actions: catalog, quote, checkout.`
    }, { status: 400 });

  } catch (err: any) {
    console.error("Protocol adapter error:", err);
    return NextResponse.json({
      status: "ERROR",
      error: "ADAPTER_FAILURE",
      details: err?.message || "Internal server error"
    }, { status: 500 });
  }
}
