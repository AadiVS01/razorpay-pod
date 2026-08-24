import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase, supabasePublic } from "@/lib/supabase";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { product_id, bid_price_paise, size } = body;

    if (!product_id || !bid_price_paise || !size) {
      return NextResponse.json(
        { status: "error", error: "MISSING_PARAMETERS", details: "Required: product_id, bid_price_paise, size" },
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

    // 1. Fetch live product from Supabase to check base price & stock
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

    // 2. Enforce Bidding Policy (Max 10% discount allowed)
    const basePrice = product.price; // in paise
    const minAcceptedPrice = Math.round(basePrice * 0.9); // 10% discount cap

    if (bid_price_paise < minAcceptedPrice) {
      return NextResponse.json(
        {
          status: "REJECTED",
          error: "BID_TOO_LOW",
          details: `Bid of ₹${(bid_price_paise / 100).toFixed(2)} is below the merchant's 10% negotiation boundary (Minimum accepted: ₹${(minAcceptedPrice / 100).toFixed(2)}).`
        },
        { status: 422 }
      );
    }

    // 3. Generate Cryptographically Signed Quote Token (Stateless validation)
    const secret = process.env.RAZORPAY_KEY_SECRET || "merchant_gateway_secret_key_1029";
    const expiresAt = Date.now() + 5 * 60 * 1000; // Quote expires in 5 minutes
    
    const message = `${product_id}:${bid_price_paise}:${expiresAt}:${size}`;
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
