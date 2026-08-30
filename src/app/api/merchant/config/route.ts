import { NextRequest, NextResponse } from "next/server";
import { getMerchantConfig, saveMerchantConfig } from "@/lib/merchant-config";
import { getAdminSupabase, supabasePublic } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = getMerchantConfig();
    return NextResponse.json({ status: "success", config }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { status: "error", error: "CONFIG_READ_FAILED", details: err?.message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { config, products } = body;

    if (!config) {
      return NextResponse.json(
        { status: "error", error: "MISSING_CONFIG", details: "Merchant config object is required." },
        { status: 400 }
      );
    }

    // 1. Validate & Save local policy configuration
    try {
      saveMerchantConfig(config);
    } catch (validationErr: any) {
      return NextResponse.json(
        { status: "error", error: "INVALID_CONFIG", details: validationErr?.message },
        { status: 422 }
      );
    }

    // 2. Validate & Update Supabase products table (Server-side authoritative write)
    if (products && Array.isArray(products)) {
      const supabase = getAdminSupabase() || supabasePublic;
      if (!supabase) {
        return NextResponse.json(
          { status: "error", error: "DATABASE_UNAVAILABLE", details: "Could not connect to database for product updates." },
          { status: 500 }
        );
      }

      for (const p of products) {
        // Server-side validation
        if (p.price_paise === undefined || p.price_paise < 0) {
          return NextResponse.json(
            { status: "error", error: "INVALID_PRODUCT_PRICE", details: "Product price cannot be negative." },
            { status: 422 }
          );
        }
        if (p.stock === undefined || p.stock < 0) {
          return NextResponse.json(
            { status: "error", error: "INVALID_PRODUCT_STOCK", details: "Product stock cannot be negative." },
            { status: 422 }
          );
        }

        const updatePayload: any = {
          price: p.price_paise,
          stock: p.stock,
          active: p.active
        };

        if (p.name) updatePayload.name = p.name;
        if (p.category) updatePayload.category = p.category;
        if (p.sizes && Array.isArray(p.sizes)) updatePayload.sizes = p.sizes;
        if (p.colors && Array.isArray(p.colors)) updatePayload.colors = p.colors;

        console.log(`[MERCHANT_CONFIG] Updating product ${p.id} -> Price: ₹${p.price_paise / 100}, Stock: ${p.stock}, Active: ${p.active}`);
        
        const { error: dbErr } = await supabase
          .from("products")
          .update(updatePayload)
          .eq("id", p.id);

        if (dbErr) {
          console.error(`❌ [MERCHANT_CONFIG] Product update failed in DB for ID ${p.id}:`, dbErr.message);
          return NextResponse.json(
            { status: "error", error: "DATABASE_WRITE_FAILED", details: dbErr.message },
            { status: 500 }
          );
        }
      }
    }

    return NextResponse.json({
      status: "success",
      message: "Merchant configuration and products updated successfully."
    }, { status: 200 });

  } catch (err: any) {
    console.error("❌ [MERCHANT_CONFIG] Error processing update:", err);
    return NextResponse.json(
      { status: "error", error: "CONFIG_UPDATE_FAILED", details: err?.message },
      { status: 500 }
    );
  }
}
