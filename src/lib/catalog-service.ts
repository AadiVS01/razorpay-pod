import { Product, AgentProductItem, AgentCatalogResponse, CatalogFilterParams, BundleOffer, MerchantCapabilityManifest } from "@/types/catalog";
import { getAdminSupabase, supabasePublic } from "./supabase";
import { getMerchantConfig } from "./merchant-config";

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

  const displayStock = product.stock;

  // AI-optimized summary description
  const aiSummary = `${product.name} [${product.category || "Apparel"}]: ₹${priceInr}. Available stock: ${displayStock} units. Available sizes: ${product.sizes.join(", ")}. Colors: ${colors.join(", ") || "Standard"}. ${product.description || ""}`;

  const config = getMerchantConfig();
  const override = config.product_overrides[product.id];
  const isNegotiable = config.policy.agent_can_negotiate && (override ? override.negotiable : true);
  const maxDiscount = override ? override.max_discount_percent : 10;

  let bundleOffers: BundleOffer[] = [];
  if (config.policy.agent_can_recommend_bundles) {
    const activeBundles = config.bundle_rules.filter(
      b => b.active && (b.product_a_id === product.id || b.product_b_id === product.id)
    );
    bundleOffers = activeBundles.map(b => ({
      addon_category: b.product_a_id === product.id ? "Pants" : "T-Shirts",
      discount_pct: b.discount_percent,
      description: `Bundle with matching item for a ${b.discount_percent}% combo discount.`,
    }));
  }

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
    stock: displayStock,
    in_stock: product.stock > 0,
    images: resolvedImages,
    color_images: product.color_images,
    ai_summary: aiSummary,
    bundle_offers: bundleOffers,
    negotiable: isNegotiable,
    negotiation_policy: {
      max_allowed_discount_pct: maxDiscount,
      quote_endpoint: "/api/agent/quote"
    },
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
  const config = getMerchantConfig();

  const manifest: MerchantCapabilityManifest = {
    manifest_type: "protocol-shaped merchant capability manifest",
    policy_version: "v1.0",
    agent_permissions: {
      can_recommend_bundles: config.policy.agent_can_recommend_bundles,
      can_negotiate: config.policy.agent_can_negotiate,
      can_checkout: config.policy.agent_can_checkout,
    },
    mandate_required: config.policy.mandate_required,
    max_autonomous_checkout_inr: config.policy.max_autonomous_checkout_paise / 100,
    max_autonomous_checkout_paise: config.policy.max_autonomous_checkout_paise,
    quote_expiry_seconds: config.policy.quote_expiry_seconds,
    active_bundles: config.bundle_rules.filter(b => b.active).map(b => ({
      id: b.id,
      name: b.name,
      discount_percent: b.discount_percent,
      product_a_id: b.product_a_id,
      product_b_id: b.product_b_id,
    })),
  };

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
    merchant_capability_manifest: manifest,
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
