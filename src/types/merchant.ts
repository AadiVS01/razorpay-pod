import { GrowthRule } from "@/lib/growth-engine";

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

export interface PolicyPerformanceMetrics {
  orders_completed: number;
  revenue_captured_paise: number;
  average_order_value_paise: number;
  quotes_issued: number;
  quote_success_rate_percent: number | null;
  growth_conversion_rate_percent: number | null;
  incremental_revenue_paise: number;
  buyer_savings_paise: number;
  blocked_attempts: number;
  payment_recoveries: number;
  recovery_rate_percent: number | null;
  first_activity_at: string | null;
  last_activity_at: string | null;
}

export interface PolicyVersionDetailResponse {
  status: "success";
  policy_version: string;
  version_status: "active" | "superseded";
  configuration: {
    autonomous_cap_paise: number;
    max_discount_percent: number;
    margin_floor_percent: number;
    quote_expiry_seconds: number;
    mandate_required: boolean;
    growth_rule_count: number;
  };
  performance: PolicyPerformanceMetrics;
}
