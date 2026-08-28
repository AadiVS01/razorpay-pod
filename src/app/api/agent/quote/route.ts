import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase, supabasePublic } from "@/lib/supabase";
import { getMerchantConfig } from "@/lib/merchant-config";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { product_id, bid_price_paise, size, quantity = 1, cart_id = "default_cart" } = body;

    if (!product_id || !bid_price_paise || !size) {
      return NextResponse.json(
        { status: "error", error: "MISSING_PARAMETERS", details: "Required: product_id, bid_price_paise, size" },
        { status: 400 }
      );
    }

    const config = getMerchantConfig();

    // 1. Enforce Global Policy
    if (!config.policy.agent_can_negotiate) {
      return NextResponse.json(
        {
          status: "REJECTED",
          error: "NEGOTIATION_DISABLED",
          details: "Negotiation is currently disabled by global merchant settings."
        },
        { status: 422 }
      );
    }

    // 2. Enforce Product Override
    const override = config.product_overrides[product_id];
    const isNegotiable = override ? override.negotiable : true;
    if (!isNegotiable) {
      return NextResponse.json(
        {
          status: "REJECTED",
          error: "NEGOTIATION_DISABLED",
          details: "Negotiation for this product has been disabled by merchant overrides."
        },
        { status: 422 }
      );
    }

    const supabase = getAdminSupabase() || supabasePublic;
    if (!supabase) {
      return NextResponse.json(
        { status: "error", error: "DATABASE_UNAVAILABLE" },
        { status: 500 }
      );
    }

    // 3. Fetch live product from Supabase to check base price & stock
    const { data: product, error } = await supabase
      .from("products")
      .select("*")
      .eq("id", product_id)
      .single();

    if (error || !product) {
      return NextResponse.json(
        { status: "error", error: "PRODUCT_NOT_FOUND", details: `Product with ID ${product_id} not found.` },
        { status: 404 }
      );
    }

    if (product.stock <= 0) {
      return NextResponse.json(
        { status: "error", error: "OUT_OF_STOCK", details: "Product is currently out of stock." },
        { status: 422 }
      );
    }

    // 4. Enforce Custom Discount Boundaries
    const basePrice = product.price; // in paise
    const maxDiscountPct = override ? override.max_discount_percent : 10;
    const minAcceptedPrice = Math.round(basePrice * (1 - maxDiscountPct / 100));

    if (bid_price_paise < minAcceptedPrice) {
      return NextResponse.json(
        {
          status: "REJECTED",
          error: "BID_TOO_LOW",
          details: `Bid rejected: ₹${(bid_price_paise / 100).toFixed(2)} is below the merchant’s minimum accepted price of ₹${(minAcceptedPrice / 100).toFixed(2)}.`,
          suggested_action: `submit a bid of at least ₹${(minAcceptedPrice / 100).toFixed(2)} or choose the bundle offer.`
        },
        { status: 422 }
      );
    }

    // 5. Generate Cryptographically Signed Quote Token (Stateless validation with v1 version)
    const secret = process.env.RAZORPAY_KEY_SECRET || "merchant_gateway_secret_key_1029";
    const expiresAt = Date.now() + (config.policy.quote_expiry_seconds * 1000);
    
    const message = `${product_id}:${bid_price_paise}:${expiresAt}:${size}:${quantity}:${cart_id}:v1`;
    const hmac = crypto.createHmac("sha256", secret).update(message).digest("hex");
    const quoteId = `quote_${Buffer.from(`${message}:${hmac}`).toString("base64")}`;

    console.log(`✅ [BIDS] Generated signed quote token for product ${product.name}. Agreed Price: ₹${(bid_price_paise / 100).toFixed(2)}`);

    return NextResponse.json({
      status: "ACCEPTED",
      quote_id: quoteId,
      product_id,
      agreed_price_paise: bid_price_paise,
      currency: "INR",
      expires_at: new Date(expiresAt).toISOString(),
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
