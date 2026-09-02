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

export interface PolicyVersionSnapshot {
  version: string;
  created_at: string;
  status: "active" | "superseded";
  change_summary: string;
  policy: MerchantPolicy;
  product_overrides: Record<string, ProductOverride>;
  bundle_rules: BundleRule[];
}

const configDir = path.join(process.cwd(), "src/data");
const configPath = path.join(configDir, "merchant-config.json");
const versionsPath = path.join(configDir, "policy-versions.json");
const ledgerPath = path.join(configDir, "trust-ledger.json");

const DEFAULT_CONFIG: MerchantConfig = {
  policy: {
    max_autonomous_checkout_paise: 70000, // ₹700
    mandate_required: true,
    agent_can_recommend_bundles: true,
    agent_can_negotiate: true,
    agent_can_checkout: true,
    quote_expiry_seconds: 600 // 10 minutes (600 seconds)
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

const INITIAL_VERSION: PolicyVersionSnapshot = {
  version: "v1",
  created_at: "2026-08-28T09:39:13.000Z",
  status: "active",
  change_summary: "Initial baseline revenue policy with 10% discount cap, 15% bundle deal, and 600s quote TTL.",
  policy: { ...DEFAULT_CONFIG.policy },
  product_overrides: { ...DEFAULT_CONFIG.product_overrides },
  bundle_rules: [...DEFAULT_CONFIG.bundle_rules]
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
    return JSON.parse(data);
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

  for (const [prodId, override] of Object.entries(config.product_overrides)) {
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
    JSON.stringify(currentActive.bundle_rules) === JSON.stringify(config.bundle_rules);

  if (isPolicyEqual) {
    // Only products table was updated or identical re-save
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
    change_summary: changeSummary || `Policy updated: Cap ₹${config.policy.max_autonomous_checkout_paise / 100}, TTL ${config.policy.quote_expiry_seconds}s, ${config.bundle_rules.length} bundle(s).`,
    policy: { ...config.policy },
    product_overrides: { ...config.product_overrides },
    bundle_rules: [...config.bundle_rules]
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
    bundle_rules: [...targetSnapshot.bundle_rules]
  };

  return saveMerchantConfig(restoredConfig, `Rollback to policy snapshot ${targetVersionId}`);
}
