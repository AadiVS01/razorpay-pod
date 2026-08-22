import { NextRequest, NextResponse } from "next/server";
import { getAgentCatalog } from "@/lib/catalog-service";
import { CatalogFilterParams } from "@/types/catalog";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const category = searchParams.get("category") || undefined;
    const inStockParam = searchParams.get("in_stock");
    const inStock = inStockParam === "true" || inStockParam === "1" ? true : undefined;
    
    const maxPriceParam = searchParams.get("max_price");
    const maxPrice = maxPriceParam ? parseFloat(maxPriceParam) : undefined;
    
    const query = searchParams.get("q") || searchParams.get("query") || undefined;

    const filters: CatalogFilterParams = {
      category: category && category !== "All" ? category : undefined,
      in_stock: inStock,
      max_price: maxPrice && !isNaN(maxPrice) ? maxPrice : undefined,
      q: query,
    };

    const responseData = await getAgentCatalog(filters);

    return NextResponse.json(responseData, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Agent-ID",
        "Cache-Control": "public, s-maxage=10, stale-while-revalidate=59",
      },
    });
  } catch (error: any) {
    console.error("Agent catalog API error:", error);
    return NextResponse.json(
      {
        status: "error",
        error: "Failed to retrieve machine-readable catalog",
        details: error?.message || "Internal server error",
      },
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
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Agent-ID",
    },
  });
}
