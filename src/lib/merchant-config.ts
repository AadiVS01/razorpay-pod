import fs from "fs";
import path from "path";
import { GrowthRule } from "./growth-engine";

export interface MerchantPolicy {
  max_autonomous_checkout_paise: number;
  mandate_required: boolean;
  agent_can_recommend_bundles: boolean;
  agent_can_recommend_growth_rules?: boolean;
  agent_can_negotiate: boolean;
  agent_can_checkout: boolean;
  quote_expiry_seconds: number;
  can_discover_products?: boolean;
  can_apply_promotions?: boolean;
  can_offer_welcome_incentives?: boolean;
  can_offer_returning_incentives?: boolean;
  can_initiate_recovery?: boolean;
  can_suggest_reorders?: boolean;
  max_discount_percent?: number;
  margin_floor_percent?: number;
  promotion_stacking_allowed?: boolean;
  max_recommendations_per_interaction?: number;
  recovery_retry_limit?: number;
}

export interface ProductOverride {
  negotiable: boolean;
  max_discount_percent: number;
}

export interface BundleRule {
  id: string;
  name: string;
  discount_percent: number;
  active: boolean;
  product_ids?: string[];
  product_a_id?: string;
  product_b_id?: string;
  recommendation_reason?: string;
}

export interface MerchantConfig {
  policy: MerchantPolicy;
  product_overrides: Record<string, ProductOverride>;
  bundle_rules: BundleRule[];
  growth_rules: GrowthRule[];
}

export interface PolicyVersionSnapshot {
  version: string;
  created_at: string;
  status: "active" | "superseded";
  change_summary: string;
  policy: MerchantPolicy;
  product_overrides: Record<string, ProductOverride>;
  bundle_rules: BundleRule[];
  growth_rules?: GrowthRule[];
}

const configDir = path.join(process.cwd(), "src/data");
const configPath = path.join(configDir, "merchant-config.json");
const versionsPath = path.join(configDir, "policy-versions.json");
const ledgerPath = path.join(configDir, "trust-ledger.json");

export const DEFAULT_GROWTH_RULES: GrowthRule[] = [
  {
    id: "growth_bundle_outfit",
    name: "Complete Outfit Bundle",
    type: "bundle_discount",
    description: "Pair Argentina Sun Tee with Everyday Cargo Pants for 10% off.",
    product_ids: [
      "977da225-f3ed-46a0-abf1-4ae18739e1a1",
      "dcac52b4-48e5-4c9a-9c10-b6f2510ec199"
    ],
    discount_percent: 10,
    stackable: false,
    active: true,
    recommendation_reason: "Pair the Argentina Sun Tee with Everyday Cargo Pants for a complete streetwear fit with 10% savings."
  },
  {
    id: "growth_b3g1_socks",
    name: "Crew Socks Buy 3 Get 1 Free",
    type: "buy_x_get_y",
    description: "Buy 3 Crew Socks 3-Packs, get 1 additional pack free.",
    product_ids: ["73bdabf5-c327-4780-a1e4-03ed277e67f0"],
    buy_quantity: 3,
    free_quantity: 1,
    max_redemptions_per_order: 1,
    stackable: false,
    active: true,
    recommendation_reason: "Stock up on streetwear basics: Buy 3 packs of Crew Socks and get 1 free automatically."
  },
  {
    id: "growth_qty_tee",
    name: "Tee Multi-Pack Volume Discount",
    type: "quantity_discount",
    description: "Buy 2 for 5% off, buy 3 or more for 10% off.",
    product_ids: ["977da225-f3ed-46a0-abf1-4ae18739e1a1"],
    quantity_tiers: [
      { min_quantity: 2, discount_percent: 5 },
      { min_quantity: 3, discount_percent: 10 }
    ],
    stackable: false,
    active: true,
    recommendation_reason: "Tiered drop savings: Buy 2 Argentina Sun Tees for 5% off, or 3+ for 10% off."
  },
  {
    id: "growth_cross_sell_cap",
    name: "Street Cap Accessory Cross-Sell",
    type: "cross_sell",
    description: "5% off Street Cap when paired with Argentina Sun Tee.",
    product_ids: ["e715bc27-d310-4384-b1ff-86d342ccd8ae"],
    trigger_product_ids: ["977da225-f3ed-46a0-abf1-4ae18739e1a1"],
    reward_product_ids: ["e715bc27-d310-4384-b1ff-86d342ccd8ae"],
    discount_percent: 5,
    stackable: true,
    active: true,
    recommendation_reason: "Complete your head-to-toe look with an Essential Street Cap for an extra 5% off."
  },
  {
    id: "growth_upsell_sneakers",
    name: "Court Canvas Footwear Upgrade",
    type: "upsell",
    description: "8% off Court Canvas Sneakers when buying apparel.",
    product_ids: ["53717c5b-e2fe-4dbb-bbdb-d490fdd32c95"],
    trigger_product_ids: ["977da225-f3ed-46a0-abf1-4ae18739e1a1", "dcac52b4-48e5-4c9a-9c10-b6f2510ec199"],
    reward_product_ids: ["53717c5b-e2fe-4dbb-bbdb-d490fdd32c95"],
    discount_percent: 8,
    stackable: false,
    active: true,
    recommendation_reason: "Upgrade your order with Court Canvas Sneakers for an exclusive 8% footwear discount."
  },
  {
    id: "growth_welcome_drop",
    name: "First Drop Welcome Privilege",
    type: "welcome_offer",
    description: "5% off first order (max ₹100) for new AI buyers.",
    product_ids: [],
    discount_percent: 5,
    max_discount_paise: 10000, // ₹100
    buyer_eligibility: "new_buyer",
    stackable: false,
    active: true,
    recommendation_reason: "Welcome to ZeroClick: First-time buyers get 5% off (up to ₹100)."
  },
  {
    id: "growth_repeat_buyer",
    name: "Loyal Collector Privilege",
    type: "returning_buyer_offer",
    description: "5% off for returning buyers with 2+ completed purchases.",
    product_ids: [],
    discount_percent: 5,
    buyer_eligibility: "returning_buyer",
    stackable: false,
    active: true,
    recommendation_reason: "Thank you for returning: Repeat collectors receive 5% off their autonomous order."
  },
  {
    id: "growth_cart_threshold_vip",
    name: "High-Tier Order Credit",
    type: "cart_threshold_offer",
    description: "₹250 flat discount on orders ₹3,500 and above.",
    product_ids: [],
    min_cart_value_paise: 350000, // ₹3,500
    discount_amount_paise: 25000, // ₹250
    stackable: false,
    active: true,
    recommendation_reason: "Orders above ₹3,500 unlock an instant ₹250 High-Tier cart discount."
  },
  {
    id: "growth_recovery_incentive",
    name: "Instant Drop Recovery Incentive",
    type: "payment_recovery_offer",
    description: "5% discount on retry after payment glitch or timeout.",
    product_ids: [],
    discount_percent: 5,
    max_discount_paise: 15000, // ₹150
    stackable: false,
    active: true,
    recommendation_reason: "We saved your drop: Apply an instant 5% recovery discount on retry."
  },
  {
    id: "growth_reorder_replenishment",
    name: "Seasonal Wardrobe Replenishment",
    type: "reorder_offer",
    description: "10% off replenishment orders placed after 30 days.",
    product_ids: [],
    reorder_interval_days: 30,
    discount_percent: 10,
    stackable: false,
    active: true,
    recommendation_reason: "Time to refresh: Reorder your favorite pieces after 30 days for 10% off."
  }
];

const DEFAULT_CONFIG: MerchantConfig = {
  policy: {
    max_autonomous_checkout_paise: 400000, // ₹4,000
    mandate_required: true,
    agent_can_recommend_bundles: true,
    agent_can_recommend_growth_rules: true,
    agent_can_negotiate: true,
    agent_can_checkout: true,
    quote_expiry_seconds: 900, // 15 minutes (900 seconds)
    can_discover_products: true,
    can_apply_promotions: true,
    can_offer_welcome_incentives: true,
    can_offer_returning_incentives: true,
    can_initiate_recovery: true,
    can_suggest_reorders: true,
    max_discount_percent: 25,
    margin_floor_percent: 60,
    promotion_stacking_allowed: false,
    max_recommendations_per_interaction: 2,
    recovery_retry_limit: 1
  },
  product_overrides: {
    "977da225-f3ed-46a0-abf1-4ae18739e1a1": {
      negotiable: true,
      max_discount_percent: 10
    },
    "dcac52b4-48e5-4c9a-9c10-b6f2510ec199": {
      negotiable: true,
      max_discount_percent: 8
    },
    "53717c5b-e2fe-4dbb-bbdb-d490fdd32c95": {
      negotiable: false,
      max_discount_percent: 0
    },
    "e715bc27-d310-4384-b1ff-86d342ccd8ae": {
      negotiable: true,
      max_discount_percent: 5
    },
    "a2a5cffc-db36-4d2c-9ed0-a6d0a78ae3a8": {
      negotiable: true,
      max_discount_percent: 7
    },
    "73bdabf5-c327-4780-a1e4-03ed277e67f0": {
      negotiable: true,
      max_discount_percent: 5
    }
  },
  bundle_rules: [
    {
      id: "bundle_complete_outfit",
      name: "Complete Outfit",
      discount_percent: 10,
      active: true,
      product_ids: [
        "977da225-f3ed-46a0-abf1-4ae18739e1a1",
        "dcac52b4-48e5-4c9a-9c10-b6f2510ec199"
      ],
      product_a_id: "977da225-f3ed-46a0-abf1-4ae18739e1a1",
      product_b_id: "dcac52b4-48e5-4c9a-9c10-b6f2510ec199",
      recommendation_reason: "Pair the Argentina Sun Tee with Everyday Cargo Pants for a complete streetwear fit with 10% savings."
    }
  ],
  growth_rules: DEFAULT_GROWTH_RULES
};

const INITIAL_VERSION: PolicyVersionSnapshot = {
  version: "v1",
  created_at: "2026-08-28T09:39:13.000Z",
  status: "active",
  change_summary: "Initial baseline revenue policy with 10 Growth Rules, 10% bundle deal, and 900s quote TTL.",
  policy: { ...DEFAULT_CONFIG.policy },
  product_overrides: { ...DEFAULT_CONFIG.product_overrides },
  bundle_rules: [...DEFAULT_CONFIG.bundle_rules],
  growth_rules: [...DEFAULT_CONFIG.growth_rules]
};

function ensureFilesExist(): void {
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8");
  }
  if (!fs.existsSync(versionsPath)) {
    fs.writeFileSync(versionsPath, JSON.stringify([INITIAL_VERSION], null, 2), "utf-8");
  }
}

/**
 * Server-only helper to read active merchant settings
 */
export function getMerchantConfig(): MerchantConfig {
  try {
    ensureFilesExist();
    const data = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(data);
    return {
      policy: { ...DEFAULT_CONFIG.policy, ...parsed.policy },
      product_overrides: parsed.product_overrides || DEFAULT_CONFIG.product_overrides,
      bundle_rules: parsed.bundle_rules || DEFAULT_CONFIG.bundle_rules,
      growth_rules: parsed.growth_rules || DEFAULT_GROWTH_RULES
    };
  } catch (err) {
    console.error("❌ [MERCHANT_CONFIG] Failed to read settings, returning defaults:", err);
    return DEFAULT_CONFIG;
  }
}

/**
 * Derives quote usage count per policy version from Trust Ledger without mutating version snapshots
 */
export function getDerivedQuoteCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  try {
    if (fs.existsSync(ledgerPath)) {
      const data = fs.readFileSync(ledgerPath, "utf-8");
      const ledger = JSON.parse(data);
      if (Array.isArray(ledger)) {
        for (const item of ledger) {
          if (item.action === "QUOTE_ISSUED" || item.action === "ORDER_CREATED") {
            const ver = item.policy_version || "v1";
            counts[ver] = (counts[ver] || 0) + 1;
          }
        }
      }
    }
  } catch (err) {
    console.warn("⚠️ [POLICY_VERSION] Could not derive quote counts from ledger:", err);
  }
  return counts;
}

/**
 * Retrieves all immutable policy version records paired with derived quote usage counts
 */
export function getPolicyVersions(): (PolicyVersionSnapshot & { quote_count: number })[] {
  try {
    ensureFilesExist();
    const data = fs.readFileSync(versionsPath, "utf-8");
    const versions: PolicyVersionSnapshot[] = JSON.parse(data);
    const quoteCounts = getDerivedQuoteCounts();

    return versions.map(v => ({
      ...v,
      growth_rules: v.growth_rules || DEFAULT_GROWTH_RULES,
      quote_count: quoteCounts[v.version] || 0
    }));
  } catch (err) {
    console.error("❌ [POLICY_VERSION] Failed to read policy versions:", err);
    return [{ ...INITIAL_VERSION, quote_count: 0 }];
  }
}

/**
 * Retrieves the currently active policy version string (e.g. "v1", "v2")
 */
export function getActivePolicyVersion(): string {
  try {
    const versions = getPolicyVersions();
    const active = versions.find(v => v.status === "active");
    return active ? active.version : "v1";
  } catch {
    return "v1";
  }
}

/**
 * Validates merchant configuration boundaries
 */
export function validateMerchantConfig(config: MerchantConfig): void {
  if (config.policy.max_autonomous_checkout_paise < 0) {
    throw new Error("Maximum checkout cap cannot be negative.");
  }
  if (config.policy.quote_expiry_seconds <= 0 || config.policy.quote_expiry_seconds > 86400) {
    throw new Error("Quote expiry must be between 1 second and 24 hours.");
  }

  for (const bundle of config.bundle_rules || []) {
    if (bundle.discount_percent < 0 || bundle.discount_percent > 100) {
      throw new Error(`Invalid bundle discount percentage for "${bundle.name}": must be 0-100%.`);
    }
    if (!bundle.product_a_id || !bundle.product_b_id) {
      throw new Error(`Bundle "${bundle.name}" must contain valid Product A and Product B IDs.`);
    }
    if (bundle.product_a_id === bundle.product_b_id) {
      throw new Error(`Bundle "${bundle.name}" cannot bundle a product with itself.`);
    }
  }

  for (const rule of config.growth_rules || []) {
    if (rule.discount_percent && (rule.discount_percent < 0 || rule.discount_percent > 100)) {
      throw new Error(`Invalid discount percentage for growth rule "${rule.name}": must be 0-100%.`);
    }
    if (rule.margin_floor_percent && (rule.margin_floor_percent < 0 || rule.margin_floor_percent > 100)) {
      throw new Error(`Invalid margin floor for growth rule "${rule.name}": must be 0-100%.`);
    }
  }

  for (const [prodId, override] of Object.entries(config.product_overrides || {})) {
    if (override.max_discount_percent < 0 || override.max_discount_percent > 100) {
      throw new Error(`Invalid negotiation discount cap for product override ${prodId}: must be 0-100%.`);
    }
  }
}

/**
 * Server-only helper to write validated merchant settings and create immutable policy versions
 */
export function saveMerchantConfig(config: MerchantConfig, changeSummary?: string): PolicyVersionSnapshot {
  validateMerchantConfig(config);
  ensureFilesExist();

  // Read existing versions
  const versionsData = fs.readFileSync(versionsPath, "utf-8");
  const versions: PolicyVersionSnapshot[] = JSON.parse(versionsData);

  // Check if policy parameters actually changed
  const currentActive = versions.find(v => v.status === "active") || versions[versions.length - 1];
  const isPolicyEqual = currentActive &&
    JSON.stringify(currentActive.policy) === JSON.stringify(config.policy) &&
    JSON.stringify(currentActive.product_overrides) === JSON.stringify(config.product_overrides) &&
    JSON.stringify(currentActive.bundle_rules) === JSON.stringify(config.bundle_rules) &&
    JSON.stringify(currentActive.growth_rules || []) === JSON.stringify(config.growth_rules || []);

  if (isPolicyEqual) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    return currentActive;
  }

  // Generate new immutable version
  const nextNum = versions.length + 1;
  const nextVersionTag = `v${nextNum}`;

  // Mark all previous versions as superseded
  const updatedVersions: PolicyVersionSnapshot[] = versions.map(v => ({
    ...v,
    status: "superseded" as const
  }));

  const newVersion: PolicyVersionSnapshot = {
    version: nextVersionTag,
    created_at: new Date().toISOString(),
    status: "active",
    change_summary: changeSummary || `Policy updated: Cap ₹${config.policy.max_autonomous_checkout_paise / 100}, TTL ${config.policy.quote_expiry_seconds}s, ${(config.growth_rules || []).length} growth rule(s).`,
    policy: { ...config.policy },
    product_overrides: { ...config.product_overrides },
    bundle_rules: [...config.bundle_rules],
    growth_rules: config.growth_rules ? [...config.growth_rules] : [...DEFAULT_GROWTH_RULES]
  };

  updatedVersions.push(newVersion);

  // Save active config and immutable history
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  fs.writeFileSync(versionsPath, JSON.stringify(updatedVersions, null, 2), "utf-8");

  console.log(`✅ [POLICY_VERSION] Created immutable version ${nextVersionTag}: ${newVersion.change_summary}`);
  return newVersion;
}

/**
 * Rollback helper: creates a NEW version cloning the historical snapshot (never mutates history)
 */
export function rollbackToVersion(targetVersionId: string): PolicyVersionSnapshot {
  ensureFilesExist();
  const versionsData = fs.readFileSync(versionsPath, "utf-8");
  const versions: PolicyVersionSnapshot[] = JSON.parse(versionsData);

  const targetSnapshot = versions.find(v => v.version === targetVersionId);
  if (!targetSnapshot) {
    throw new Error(`Target policy version "${targetVersionId}" not found.`);
  }

  const restoredConfig: MerchantConfig = {
    policy: { ...targetSnapshot.policy },
    product_overrides: { ...targetSnapshot.product_overrides },
    bundle_rules: [...targetSnapshot.bundle_rules],
    growth_rules: targetSnapshot.growth_rules ? [...targetSnapshot.growth_rules] : [...DEFAULT_GROWTH_RULES]
  };

  return saveMerchantConfig(restoredConfig, `Rollback to policy snapshot ${targetVersionId}`);
}

/**
 * Derives business performance metrics attributable to activity under a specific policy version
 */
export function getPolicyPerformance(versionTag: string) {
  ensureFilesExist();
  const versions = getPolicyVersions();
  const snapshot = versions.find(v => v.version.toLowerCase() === versionTag.toLowerCase());
  if (!snapshot) {
    return null;
  }

  let events: any[] = [];
  try {
    if (fs.existsSync(ledgerPath)) {
      const data = fs.readFileSync(ledgerPath, "utf-8");
      events = JSON.parse(data);
    }
  } catch (err) {
    console.warn("⚠️ [POLICY_PERFORMANCE] Failed to read ledger:", err);
  }

  const versionEvents = events.filter(e => (e.policy_version || "v1").toLowerCase() === versionTag.toLowerCase());

  let ordersCompleted = 0;
  let revenueCapturedPaise = 0;
  let quotesIssued = 0;
  let buyerSavingsPaise = 0;
  let incrementalRevenuePaise = 0;
  let growthOrdersCount = 0;
  let blockedAttempts = 0;
  let paymentRecoveries = 0;
  let paymentFailures = 0;
  let firstActivityAt: string | null = null;
  let lastActivityAt: string | null = null;

  if (versionEvents.length > 0) {
    const sorted = [...versionEvents].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    firstActivityAt = sorted[0].timestamp;
    lastActivityAt = sorted[sorted.length - 1].timestamp;
  }

  for (const event of versionEvents) {
    if (event.action === "QUOTE_ISSUED" && event.policy_result === "ALLOWED") {
      quotesIssued++;
    }

    if (event.action === "ORDER_CREATED" || event.action === "PAYMENT_CAPTURED") {
      if (event.policy_result === "ALLOWED" && event.outcome === "COMPLETED") {
        ordersCompleted++;
        const finalPaise = (event.amount_after !== null && event.amount_after !== undefined)
          ? event.amount_after * 100
          : (event.amount_before ? event.amount_before * 100 : 0);
        revenueCapturedPaise += finalPaise;

        if (event.arithmetic) {
          buyerSavingsPaise += (event.arithmetic.buyer_savings || 0) * 100;
          if (event.arithmetic.incremental_revenue && event.arithmetic.incremental_revenue > 0) {
            incrementalRevenuePaise += event.arithmetic.incremental_revenue * 100;
            growthOrdersCount++;
          }
        } else if (event.amount_before && event.amount_after) {
          const savings = Math.max(0, event.amount_before - event.amount_after) * 100;
          buyerSavingsPaise += savings;
          if (savings > 0) growthOrdersCount++;
        }

        if (event.matched_rules && event.matched_rules.length > 0) {
          growthOrdersCount++;
        }

        if (
          event.details?.toLowerCase().includes("recovery") ||
          event.intent_summary?.toLowerCase().includes("recovery")
        ) {
          paymentRecoveries++;
        }
      }
    }

    if (
      event.action === "CHECKOUT_BLOCKED" ||
      event.policy_result === "BLOCKED" ||
      event.policy_result === "REJECTED"
    ) {
      blockedAttempts++;
    }

    if (event.action === "PAYMENT_FAILED") {
      paymentFailures++;
    }
  }

  const avgOrderValuePaise = ordersCompleted > 0 ? Math.round(revenueCapturedPaise / ordersCompleted) : 0;
  const quoteSuccessRate = quotesIssued > 0 ? Math.min(100, Math.round((ordersCompleted / quotesIssued) * 100)) : null;
  const growthConversionRate = ordersCompleted > 0 ? Math.min(100, Math.round((growthOrdersCount / ordersCompleted) * 100)) : null;
  const recoveryRate = (paymentFailures > 0 || paymentRecoveries > 0)
    ? Math.min(100, Math.round((paymentRecoveries / Math.max(1, paymentFailures + paymentRecoveries)) * 100))
    : null;

  return {
    policy_version: snapshot.version,
    version_status: snapshot.status,
    configuration: {
      autonomous_cap_paise: snapshot.policy.max_autonomous_checkout_paise,
      max_discount_percent: snapshot.policy.max_discount_percent ?? 25,
      margin_floor_percent: snapshot.policy.margin_floor_percent ?? 60,
      quote_expiry_seconds: snapshot.policy.quote_expiry_seconds,
      mandate_required: snapshot.policy.mandate_required,
      growth_rule_count: snapshot.growth_rules?.length ?? snapshot.bundle_rules?.length ?? 0
    },
    performance: {
      orders_completed: ordersCompleted,
      revenue_captured_paise: revenueCapturedPaise,
      average_order_value_paise: avgOrderValuePaise,
      quotes_issued: quotesIssued,
      quote_success_rate_percent: quoteSuccessRate,
      growth_conversion_rate_percent: growthConversionRate,
      incremental_revenue_paise: incrementalRevenuePaise,
      buyer_savings_paise: buyerSavingsPaise,
      blocked_attempts: blockedAttempts,
      payment_recoveries: paymentRecoveries,
      recovery_rate_percent: recoveryRate,
      first_activity_at: firstActivityAt,
      last_activity_at: lastActivityAt
    }
  };
}

