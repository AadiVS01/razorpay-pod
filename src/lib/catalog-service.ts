import { Product, AgentProductItem, AgentCatalogResponse, CatalogFilterParams, BundleOffer } from "@/types/catalog";
import { getAdminSupabase, supabasePublic } from "./supabase";

/**
 * Extracts all valid images from product.images and product.color_images
 */
export function getAllProductImages(product: Product): string[] {
  const images: string[] = [];
  if (product.images && product.images.length > 0) {
    images.push(...product.images);
  }
  if (product.color_images) {
    Object.values(product.color_images).forEach((list) => {
      if (Array.isArray(list)) {
        list.forEach((img) => {
          if (img && !images.includes(img)) images.push(img);
        });
      }
    });
  }
  return images;
}

/**
 * Generates dynamic cross-sell bundle offers based on product category
 */
function getBundleOffersForProduct(category: string | null): BundleOffer[] {
  const cat = (category || "").toLowerCase();
  
  if (cat.includes("hoodie") || cat.includes("jacket") || cat.includes("sweatshirt")) {
    return [
      {
        addon_category: "Accessories",
        discount_pct: 20,
        description: "Add a matching cap or tote for 20% off when bundled.",
      },
    ];
  }

  if (cat.includes("t-shirt") || cat.includes("tee") || cat.includes("anime")) {
    return [
      {
        addon_category: "Pants",
        discount_pct: 15,
        description: "Bundle with matching sweatpants for a 15% combo discount.",
      },
    ];
  }

  return [];
}

/**
 * Transforms raw DB product row to machine-optimized AgentProductItem
 */
export function transformProductForAgent(product: Product): AgentProductItem {
  const priceInr = Math.round(product.price / 100);
  const comparePriceInr = product.compare_price ? Math.round(product.compare_price / 100) : null;
  const discountPct = comparePriceInr && comparePriceInr > priceInr
    ? Math.round(((comparePriceInr - priceInr) / comparePriceInr) * 100)
    : null;

  // Formulate deterministic machine SKU
  const categoryPrefix = (product.category || "GEN").substring(0, 3).toUpperCase();
  const slugShort = product.slug.replace(/-/g, "").substring(0, 4).toUpperCase();
  const sku = `SKU-${categoryPrefix}-${slugShort}`;

  const resolvedImages = getAllProductImages(product);
  const colors = product.colors || (product.color_images ? Object.keys(product.color_images) : []);

  // AI-optimized summary description
  const aiSummary = `${product.name} [${product.category || "Apparel"}]: ₹${priceInr}. In stock: ${product.stock} units. Available sizes: ${product.sizes.join(", ")}. Colors: ${colors.join(", ") || "Standard"}. ${product.description || ""}`;

  return {
    id: product.id,
    sku,
    slug: product.slug,
    name: product.name,
    category: product.category || "General",
    price_inr: priceInr,
    price_paise: product.price,
    compare_price_inr: comparePriceInr,
    discount_pct: discountPct,
    sizes: product.sizes || ["OS"],
    colors: colors,
    stock: product.stock,
    in_stock: product.stock > 0,
    images: resolvedImages,
    color_images: product.color_images,
    ai_summary: aiSummary,
    bundle_offers: getBundleOffersForProduct(product.category),
  };
}

/**
 * Fetches raw products directly from Supabase
 */
export async function getStoreProducts(filters?: CatalogFilterParams): Promise<Product[]> {
  let products: Product[] = [];

  try {
    const supabase = getAdminSupabase() || supabasePublic;
    if (supabase) {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("active", true)
        .order("created_at", { ascending: false });

      if (!error && data) {
        products = data as Product[];
      } else if (error) {
        console.error("Supabase query error:", error);
      }
    }
  } catch (err) {
    console.error("Failed to query Supabase:", err);
  }

  // Apply filters in memory
  if (filters) {
    if (filters.category && filters.category !== "All") {
      const targetCat = filters.category.toLowerCase();
      products = products.filter(p => (p.category || "").toLowerCase() === targetCat);
    }

    if (filters.in_stock) {
      products = products.filter(p => p.stock > 0);
    }

    if (filters.max_price && filters.max_price > 0) {
      const maxPaise = filters.max_price < 10000 ? filters.max_price * 100 : filters.max_price;
      products = products.filter(p => p.price <= maxPaise);
    }

    if (filters.q && filters.q.trim().length > 0) {
      const query = filters.q.toLowerCase().trim();
      products = products.filter(p => 
        p.name.toLowerCase().includes(query) ||
        (p.description || "").toLowerCase().includes(query) ||
        (p.category || "").toLowerCase().includes(query) ||
        p.slug.toLowerCase().includes(query)
      );
    }
  }

  return products;
}

/**
 * Formats the full Machine-Readable API response for AI buyer agents
 */
export async function getAgentCatalog(filters?: CatalogFilterParams): Promise<AgentCatalogResponse> {
  const products = await getStoreProducts(filters);
  const agentProducts = products.map(transformProductForAgent);

  return {
    status: "success",
    protocol_version: "a2a-v1.0",
    store: {
      name: "ZeroClick",
      tagline: "Autonomous Agent-to-Agent Print-on-Demand Store",
      currency: "INR",
      supported_payment_rails: ["Razorpay A2A", "UPI-UAP", "Card Pre-Auth"],
      merchant_id: "rzp_merchant_zeroclick",
    },
    timestamp: new Date().toISOString(),
    filters_applied: {
      category: filters?.category,
      max_price_inr: filters?.max_price,
      in_stock_only: filters?.in_stock,
      query: filters?.q,
    },
    total_items: agentProducts.length,
    products: agentProducts,
    agent_instructions: {
      order_endpoint: "/api/razorpay/order",
      quote_endpoint: "/api/agent/quote",
      currency: "INR",
      max_recommended_single_cart_inr: 10000,
      notes: "Prices in price_inr are in full INR, price_paise are in 1/100 INR. Quantities subject to real-time stock reservation.",
    },
  };
}
