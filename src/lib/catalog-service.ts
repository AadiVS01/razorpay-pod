import { Product, AgentProductItem, AgentCatalogResponse, CatalogFilterParams, BundleOffer, MerchantCapabilityManifest } from "@/types/catalog";
import { getAdminSupabase, supabasePublic } from "./supabase";
import { getMerchantConfig, getActivePolicyVersion } from "./merchant-config";

/**
 * Mapping of product slugs to exact local public assets
 */
export const PRODUCT_ASSET_MAP: Record<string, string> = {
  "argentina-sun-tee": "/products/argentina-sun-tee.png",
  "argentina-sun-of-may-tee": "/products/argentina-sun-tee.png",
  "everyday-cargo-pants": "/products/everyday-cargo-pants.png",
  "court-canvas-sneakers": "/products/court-canvas-sneakers.png",
  "essential-street-cap": "/products/essential-street-cap.png",
  "utility-crossbody-sling": "/products/utility-crossbody-sling.png",
  "crew-socks-3-pack": "/products/crew-socks-3-pack.png",
};

/**
 * Returns the configured base URL for asset generation
 */
export function getBaseUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL;
  if (envUrl && envUrl.trim().length > 0) {
    return envUrl.trim().replace(/\/+$/, "");
  }
  return "https://razorpay-pod.vercel.app";
}

/**
 * Normalizes relative image path into an absolute public URL
 */
export function toAbsoluteImageUrl(imagePath: string, baseUrl: string = getBaseUrl()): string {
  if (!imagePath) return "";
  if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) {
    return imagePath;
  }
  const cleanPath = imagePath.startsWith("/") ? imagePath : `/${imagePath}`;
  return `${baseUrl}${cleanPath}`;
}

/**
 * Extracts all valid images from product.images and product.color_images as absolute URLs
 */
export function getAllProductImages(product: Product, baseUrl: string = getBaseUrl()): string[] {
  const rawImages: string[] = [];
  if (product.images && product.images.length > 0) {
    rawImages.push(...product.images);
  }
  if (product.color_images) {
    Object.values(product.color_images).forEach((list) => {
      if (Array.isArray(list)) {
        list.forEach((img) => {
          if (img && !rawImages.includes(img)) rawImages.push(img);
        });
      }
    });
  }
  if (rawImages.length === 0 && PRODUCT_ASSET_MAP[product.slug]) {
    rawImages.push(PRODUCT_ASSET_MAP[product.slug]);
  }
  return rawImages.map(img => toAbsoluteImageUrl(img, baseUrl));
}

/**
 * Transforms raw DB product row to machine-optimized AgentProductItem
 */
export function transformProductForAgent(product: Product): AgentProductItem {
  const baseUrl = getBaseUrl();
  const priceInr = Math.round(product.price / 100);
  const comparePriceInr = product.compare_price ? Math.round(product.compare_price / 100) : null;
  const discountPct = comparePriceInr && comparePriceInr > priceInr
    ? Math.round(((comparePriceInr - priceInr) / comparePriceInr) * 100)
    : null;

  // Formulate deterministic machine SKU
  const categoryPrefix = (product.category || "GEN").substring(0, 3).toUpperCase();
  const slugShort = product.slug.replace(/-/g, "").substring(0, 4).toUpperCase();
  const sku = `SKU-${categoryPrefix}-${slugShort}`;

  const resolvedImages = getAllProductImages(product, baseUrl);
  const fallbackAsset = PRODUCT_ASSET_MAP[product.slug] || "/products/argentina-sun-tee.png";
  const primaryImageUrl = resolvedImages.length > 0
    ? resolvedImages[0]
    : toAbsoluteImageUrl(fallbackAsset, baseUrl);
  const finalImages = resolvedImages.length > 0 ? resolvedImages : [primaryImageUrl];

  let resolvedColorImages: Record<string, string[]> | undefined = undefined;
  if (product.color_images) {
    resolvedColorImages = {};
    for (const [color, imgs] of Object.entries(product.color_images)) {
      resolvedColorImages[color] = imgs.map((img) => toAbsoluteImageUrl(img, baseUrl));
    }
  }

  const colors = product.colors || (product.color_images ? Object.keys(product.color_images) : []);

  const displayStock = product.stock;

  // AI-optimized summary description
  const aiSummary = `${product.name} [${product.category || "Apparel"}]: ₹${priceInr}. Available stock: ${displayStock} units. Available sizes: ${product.sizes.join(", ")}. Colors: ${colors.join(", ") || "Standard"}. ${product.description || ""}`;

  const config = getMerchantConfig();
  const override = config.product_overrides[product.id];
  const isNegotiable = config.policy.agent_can_negotiate && (override ? override.negotiable : true);
  const maxDiscount = override ? override.max_discount_percent : 10;

  let bundleOffers: BundleOffer[] = [];
  if (config.policy.agent_can_recommend_bundles && config.bundle_rules) {
    const activeBundles = config.bundle_rules.filter(
      b => b.active && (
        (b.product_ids && b.product_ids.includes(product.id)) ||
        b.product_a_id === product.id ||
        b.product_b_id === product.id
      )
    );
    bundleOffers = activeBundles.map(b => ({
      addon_category: b.name,
      discount_pct: b.discount_percent,
      description: b.recommendation_reason || `Bundle as part of "${b.name}" for a ${b.discount_percent}% combo discount.`,
      recommended_skus: b.product_ids || [b.product_a_id, b.product_b_id].filter(Boolean) as string[]
    }));
  }

  // Also include growth rules if applicable
  if (config.growth_rules) {
    const activeGrowth = config.growth_rules.filter(
      r => r.active && (
        r.product_ids.includes(product.id) ||
        (r.trigger_product_ids && r.trigger_product_ids.includes(product.id))
      )
    );
    for (const gr of activeGrowth) {
      if (!bundleOffers.some(bo => bo.addon_category === gr.name)) {
        bundleOffers.push({
          addon_category: gr.name,
          discount_pct: gr.discount_percent || 5,
          description: gr.recommendation_reason || gr.description,
          recommended_skus: gr.product_ids
        });
      }
    }
  }

  return {
    id: product.id,
    sku,
    slug: product.slug,
    name: product.name,
    description: product.description || "",
    category: product.category || "General",
    price_inr: priceInr,
    price_paise: product.price,
    compare_price_inr: comparePriceInr,
    discount_pct: discountPct,
    sizes: product.sizes || ["OS"],
    colors: colors,
    stock: displayStock,
    in_stock: product.stock > 0,
    image_url: primaryImageUrl,
    images: finalImages,
    image: primaryImageUrl,
    color_images: resolvedColorImages,
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
  const activeVersion = getActivePolicyVersion();

  const manifest: MerchantCapabilityManifest = {
    manifest_type: "protocol-shaped merchant capability manifest",
    policy_version: activeVersion,
    agent_permissions: {
      can_discover_products: config.policy.can_discover_products ?? true,
      can_recommend_bundles: config.policy.agent_can_recommend_bundles,
      can_recommend_growth_rules: config.policy.agent_can_recommend_growth_rules ?? true,
      can_negotiate: config.policy.agent_can_negotiate,
      can_apply_promotions: config.policy.can_apply_promotions ?? true,
      can_offer_welcome_incentives: config.policy.can_offer_welcome_incentives ?? true,
      can_offer_returning_incentives: config.policy.can_offer_returning_incentives ?? true,
      can_initiate_recovery: config.policy.can_initiate_recovery ?? true,
      can_suggest_reorders: config.policy.can_suggest_reorders ?? true,
      can_checkout: config.policy.agent_can_checkout,
    },
    mandate_required: config.policy.mandate_required,
    max_autonomous_checkout_inr: config.policy.max_autonomous_checkout_paise / 100,
    max_autonomous_checkout_paise: config.policy.max_autonomous_checkout_paise,
    max_discount_percent: config.policy.max_discount_percent ?? 25,
    margin_floor_percent: config.policy.margin_floor_percent ?? 60,
    quote_expiry_seconds: config.policy.quote_expiry_seconds,
    promotion_stacking_allowed: config.policy.promotion_stacking_allowed ?? false,
    max_recommendations_per_interaction: config.policy.max_recommendations_per_interaction ?? 2,
    recovery_retry_limit: config.policy.recovery_retry_limit ?? 1,
    active_bundles: (config.bundle_rules || []).filter(b => b.active).map(b => ({
      id: b.id,
      name: b.name,
      discount_percent: b.discount_percent,
      product_ids: b.product_ids || [b.product_a_id, b.product_b_id].filter(Boolean) as string[],
      product_a_id: b.product_a_id || (b.product_ids ? b.product_ids[0] : ""),
      product_b_id: b.product_b_id || (b.product_ids ? b.product_ids[1] : ""),
      recommendation_reason: b.recommendation_reason || `Bundle combo for a ${b.discount_percent}% discount.`
    })),
    active_growth_rules: (config.growth_rules || []).filter(r => r.active).map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      product_ids: r.product_ids,
      discount_percent: r.discount_percent,
      discount_amount_paise: r.discount_amount_paise,
      buy_quantity: r.buy_quantity,
      free_quantity: r.free_quantity,
      recommendation_reason: r.recommendation_reason,
      stackable: r.stackable
    }))
  };

  return {
    status: "success",
    version: "2026-08-20",
    generated_at: new Date().toISOString(),
    store: {
      name: "ZeroClick",
      currency: "INR",
      currency_symbol: "₹",
      total_products: agentProducts.length,
      contact: {
        agent_support: "agent-commerce@zeroclick.internal",
        gateway: "Razorpay A2A Commerce Gateway"
      }
    },
    merchant_capability_manifest: manifest,
    products: agentProducts,
    autonomous_checkout: {
      endpoint: "/api/razorpay/order",
      method: "POST",
      required_headers: {
        "Content-Type": "application/json"
      },
      supported_protocols: ["acp-shaped", "ap2-shaped", "x402-shaped"],
      protocol_adapter_endpoint: "/api/protocol/adapter",
      parameters: {
        items: "Array<{ id: string, quantity: number, price_paise?: number, size?: string, color?: string }>",
        budget_cap_paise: "number (must be <= merchant max_autonomous_checkout_paise)",
        expected_total_paise: "number (authoritative check matches item prices - bundle discounts)",
        quote_id: "string (optional: cryptographic HMAC token from /api/agent/quote)",
        idempotency_key: "string (recommended for duplicate order prevention)",
        mandate_authorized: "boolean (true if buyer pre-consented to autonomous mandate execution)"
      }
    }
  };
}
