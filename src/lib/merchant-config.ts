import fs from "fs";
import path from "path";

export interface MerchantPolicy {
  max_autonomous_checkout_paise: number;
  mandate_required: boolean;
  agent_can_recommend_bundles: boolean;
  agent_can_negotiate: boolean;
  agent_can_checkout: boolean;
  quote_expiry_seconds: number;
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
  product_a_id: string;
  product_b_id: string;
  recommendation_reason?: string;
}

export interface MerchantConfig {
  policy: MerchantPolicy;
  product_overrides: Record<string, ProductOverride>;
  bundle_rules: BundleRule[];
}

const configDir = path.join(process.cwd(), "src/data");
const configPath = path.join(configDir, "merchant-config.json");

const DEFAULT_CONFIG: MerchantConfig = {
  policy: {
    max_autonomous_checkout_paise: 70000, // ₹700
    mandate_required: true,
    agent_can_recommend_bundles: true,
    agent_can_negotiate: true,
    agent_can_checkout: true,
    quote_expiry_seconds: 600 // 10 minutes
  },
  product_overrides: {
    "977da225-f3ed-46a0-abf1-4ae18739e1a1": {
      negotiable: true,
      max_discount_percent: 10
    }
  },
  bundle_rules: [
    {
      id: "bundle_complete_outfit",
      name: "Complete Outfit",
      discount_percent: 15,
      active: true,
      product_a_id: "977da225-f3ed-46a0-abf1-4ae18739e1a1",
      product_b_id: "f2e7d02d-2de1-4638-a463-2a8525a3bc26",
      recommendation_reason: "Bundle matching pants for an elevated streetwear drop and 15% savings."
    }
  ]
};

/**
 * Server-only helper to read single-process demo merchant settings
 */
export function getMerchantConfig(): MerchantConfig {
  try {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8");
      return DEFAULT_CONFIG;
    }
    const data = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    console.error("❌ [MERCHANT_CONFIG] Failed to read settings, returning defaults:", err);
    return DEFAULT_CONFIG;
  }
}

/**
 * Server-only helper to write and validate merchant settings
 */
export function saveMerchantConfig(config: MerchantConfig): void {
  // Input validations
  if (config.policy.max_autonomous_checkout_paise < 0) {
    throw new Error("Maximum checkout cap cannot be negative.");
  }
  if (config.policy.quote_expiry_seconds <= 0 || config.policy.quote_expiry_seconds > 86400) {
    throw new Error("Quote expiry must be between 1 second and 24 hours.");
  }

  // Validate bundle rules
  for (const bundle of config.bundle_rules) {
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

  // Validate overrides
  for (const [prodId, override] of Object.entries(config.product_overrides)) {
    if (override.max_discount_percent < 0 || override.max_discount_percent > 100) {
      throw new Error(`Invalid negotiation discount cap for product override ${prodId}: must be 0-100%.`);
    }
  }

  try {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    console.log("✅ [MERCHANT_CONFIG] Successfully saved validated config to disk.");
  } catch (err) {
    console.error("❌ [MERCHANT_CONFIG] Failed to save settings to disk:", err);
    throw new Error("Configuration write failure.");
  }
}
