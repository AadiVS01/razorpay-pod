/**
 * ZeroClick Growth Engine
 * Deterministic server-side evaluation for merchant ecommerce growth rules:
 * - Bundle Discounts
 * - Buy X Get Y (e.g. Buy 3 Get 1 Free)
 * - Tiered Quantity Discounts
 * - Cross-sell & Upsell
 * - Welcome Offers (New Buyers)
 * - Returning Buyer Offers (Repeat Buyers)
 * - Cart Value Threshold Offers
 * - Payment Recovery Incentives
 * - Reorder Replenishment Offers
 */

export type GrowthRuleType =
  | "bundle_discount"
  | "buy_x_get_y"
  | "quantity_discount"
  | "cross_sell"
  | "upsell"
  | "welcome_offer"
  | "returning_buyer_offer"
  | "cart_threshold_offer"
  | "payment_recovery_offer"
  | "reorder_offer";

export type BuyerEligibilityType = "all" | "new_buyer" | "returning_buyer";

export interface QuantityTier {
  min_quantity: number;
  discount_percent: number;
}

export interface GrowthRule {
  id: string;
  name: string;
  type: GrowthRuleType;
  description: string;
  product_ids: string[];
  trigger_product_ids?: string[];
  reward_product_ids?: string[];
  
  // Rule Conditions & Values
  discount_percent?: number;
  discount_amount_paise?: number;
  buy_quantity?: number;
  free_quantity?: number;
  quantity_tiers?: QuantityTier[];
  min_cart_value_paise?: number;
  reorder_interval_days?: number;

  // Eligibility & Safety Bounds
  buyer_eligibility?: BuyerEligibilityType;
  max_discount_paise?: number;
  margin_floor_percent?: number;
  max_redemptions_per_order?: number;
  max_redemptions_per_buyer?: number;
  stackable: boolean;
  requires_marketing_consent?: boolean;

  // Active status & Agent messaging
  active: boolean;
  recommendation_reason: string;
  version?: string;
  created_at?: string;
}

export interface BuyerContext {
  session_id?: string;
  buyer_id?: string;
  is_new_buyer?: boolean;
  completed_orders_count?: number;
  has_failed_payment?: boolean;
  days_since_last_order?: number;
  marketing_consent?: boolean;
}

export interface EvaluatedItem {
  product: {
    id: string;
    name: string;
    price: number; // in paise
    cost_paise?: number;
    stock: number;
    category?: string | null;
    sizes?: string[];
    images?: string[];
  };
  quantity: number;
  price_paise: number;
}

export interface GrowthEvaluationResult {
  subtotal_paise: number;
  discount_paise: number;
  final_total_paise: number;
  buyer_savings_paise: number;
  applied_rules: Array<{
    rule_id: string;
    rule_name: string;
    rule_type: GrowthRuleType;
    discount_paise: number;
    reason: string;
  }>;
  excluded_rules?: Array<{
    rule_id: string;
    rule_name: string;
    rule_type: string;
    potential_discount_paise: number;
    reason: string;
  }>;
  free_items?: Array<{
    product_id: string;
    product_name: string;
    free_quantity: number;
  }>;
  cross_sell_recommendations?: Array<{
    product_id: string;
    product_name: string;
    discount_percent?: number;
    reason: string;
  }>;
  items: EvaluatedItem[];
}

/**
 * Validates a growth rule against active products
 */
export function validateGrowthRule(rule: GrowthRule, availableProductIds: string[]): { valid: boolean; error?: string } {
  if (!rule.id || !rule.name || !rule.type) {
    return { valid: false, error: "Rule ID, name, and type are required." };
  }

  if (!rule.product_ids || rule.product_ids.length === 0) {
    if (rule.type !== "cart_threshold_offer" && rule.type !== "welcome_offer") {
      return { valid: false, error: "At least one product must be selected for this rule type." };
    }
  }

  for (const pid of rule.product_ids || []) {
    if (!availableProductIds.includes(pid)) {
      return { valid: false, error: `Product ID "${pid}" does not exist in the active catalog.` };
    }
  }

  if (rule.type === "bundle_discount" && (!rule.discount_percent || rule.discount_percent <= 0 || rule.discount_percent > 100)) {
    return { valid: false, error: "Bundle discount requires a valid discount percentage (1-100%)." };
  }

  if (rule.type === "buy_x_get_y" && (!rule.buy_quantity || !rule.free_quantity || rule.buy_quantity <= 0 || rule.free_quantity <= 0)) {
    return { valid: false, error: "Buy X Get Y requires positive buy_quantity and free_quantity." };
  }

  if (rule.type === "cart_threshold_offer" && (!rule.min_cart_value_paise || rule.min_cart_value_paise <= 0)) {
    return { valid: false, error: "Cart threshold offer requires a positive min_cart_value_paise." };
  }

  return { valid: true };
}

/**
 * Evaluates all active growth rules for a given cart and buyer context.
 * Enforces:
 * 1. Rule eligibility (new buyer, returning buyer, cart threshold)
 * 2. Stacking rules (only allow stacking if rules declare stackable: true)
 * 3. Max discount caps and margin floors
 * 4. Deterministic arithmetic calculation
 */
export function evaluateGrowthRules(
  items: EvaluatedItem[],
  rules: GrowthRule[],
  buyerContext: BuyerContext = {},
  globalPolicy?: {
    max_discount_percent?: number;
    margin_floor_percent?: number;
    max_autonomous_checkout_paise?: number;
    promotion_stacking_allowed?: boolean;
  }
): GrowthEvaluationResult {
  const subtotalPaise = items.reduce((sum, it) => sum + (it.price_paise * it.quantity), 0);
  const productIds = items.map(it => it.product.id);
  
  const activeRules = rules.filter(r => r.active);
  const appliedRules: GrowthEvaluationResult["applied_rules"] = [];
  const excludedRules: NonNullable<GrowthEvaluationResult["excluded_rules"]> = [];
  const freeItems: NonNullable<GrowthEvaluationResult["free_items"]> = [];
  const crossSellRecs: NonNullable<GrowthEvaluationResult["cross_sell_recommendations"]> = [];
  
  let totalDiscountPaise = 0;
  let hasNonStackableApplied = false;

  for (const rule of activeRules) {
    // If a non-stackable rule is already applied and global stacking is restricted, skip further discounts
    if (hasNonStackableApplied && !rule.stackable && !globalPolicy?.promotion_stacking_allowed) {
      continue;
    }

    // 1. Check Buyer Eligibility
    if (rule.buyer_eligibility === "new_buyer") {
      const isNew = buyerContext.is_new_buyer === true || (buyerContext.completed_orders_count !== undefined && buyerContext.completed_orders_count === 0);
      if (!isNew) continue;
    }

    if (rule.buyer_eligibility === "returning_buyer") {
      const isReturning = (buyerContext.completed_orders_count ?? 0) >= 2;
      if (!isReturning) continue;
    }

    // 2. Evaluate Rule by Type
    let ruleDiscountPaise = 0;

    switch (rule.type) {
      case "bundle_discount": {
        const requiredIds = rule.product_ids || [];
        const allPresent = requiredIds.length > 0 && requiredIds.every(reqId => productIds.includes(reqId));
        
        if (allPresent) {
          const matchingItemsTotal = items
            .filter(it => requiredIds.includes(it.product.id))
            .reduce((sum, it) => sum + (it.price_paise * it.quantity), 0);
          
          const pct = rule.discount_percent || 0;
          ruleDiscountPaise = Math.round((matchingItemsTotal * pct) / 100);
        }
        break;
      }

      case "buy_x_get_y": {
        const targetId = rule.product_ids[0];
        const matchingItem = items.find(it => it.product.id === targetId);
        const buyQty = rule.buy_quantity || 3;
        const freeQty = rule.free_quantity || 1;

        if (matchingItem && matchingItem.quantity >= (buyQty + freeQty)) {
          // Quantity includes the free item: calculate the discount equivalent to the free items
          const sets = Math.floor(matchingItem.quantity / (buyQty + freeQty));
          const maxRedemptions = rule.max_redemptions_per_order || 1;
          const applicableSets = Math.min(sets, maxRedemptions);
          
          ruleDiscountPaise = applicableSets * (freeQty * matchingItem.price_paise);
          freeItems.push({
            product_id: matchingItem.product.id,
            product_name: matchingItem.product.name,
            free_quantity: applicableSets * freeQty
          });
        }
        break;
      }

      case "quantity_discount": {
        const targetId = rule.product_ids[0];
        const matchingItem = items.find(it => it.product.id === targetId);
        
        if (matchingItem && rule.quantity_tiers && rule.quantity_tiers.length > 0) {
          // Find the highest qualifying tier
          const qualifyingTier = [...rule.quantity_tiers]
            .sort((a, b) => b.min_quantity - a.min_quantity)
            .find(t => matchingItem.quantity >= t.min_quantity);

          if (qualifyingTier) {
            const itemTotal = matchingItem.price_paise * matchingItem.quantity;
            ruleDiscountPaise = Math.round((itemTotal * qualifyingTier.discount_percent) / 100);
          }
        }
        break;
      }

      case "welcome_offer": {
        const isNew = buyerContext.is_new_buyer === true || (buyerContext.completed_orders_count !== undefined && buyerContext.completed_orders_count === 0);
        if (isNew) {
          if (rule.discount_percent) {
            ruleDiscountPaise = Math.round((subtotalPaise * rule.discount_percent) / 100);
          } else if (rule.discount_amount_paise) {
            ruleDiscountPaise = rule.discount_amount_paise;
          }
        }
        break;
      }

      case "returning_buyer_offer": {
        const isReturning = (buyerContext.completed_orders_count ?? 0) >= 2;
        if (isReturning) {
          if (rule.discount_percent) {
            ruleDiscountPaise = Math.round((subtotalPaise * rule.discount_percent) / 100);
          } else if (rule.discount_amount_paise) {
            ruleDiscountPaise = rule.discount_amount_paise;
          }
        }
        break;
      }

      case "cart_threshold_offer": {
        const threshold = rule.min_cart_value_paise || 0;
        if (subtotalPaise >= threshold) {
          if (rule.discount_percent) {
            ruleDiscountPaise = Math.round((subtotalPaise * rule.discount_percent) / 100);
          } else if (rule.discount_amount_paise) {
            ruleDiscountPaise = rule.discount_amount_paise;
          }
        }
        break;
      }

      case "payment_recovery_offer": {
        if (buyerContext.has_failed_payment) {
          if (rule.discount_percent) {
            ruleDiscountPaise = Math.round((subtotalPaise * rule.discount_percent) / 100);
          } else if (rule.discount_amount_paise) {
            ruleDiscountPaise = rule.discount_amount_paise;
          }
        }
        break;
      }

      case "reorder_offer": {
        const interval = rule.reorder_interval_days || 30;
        const daysElapsed = buyerContext.days_since_last_order ?? 0;
        if (daysElapsed >= interval) {
          if (rule.discount_percent) {
            ruleDiscountPaise = Math.round((subtotalPaise * rule.discount_percent) / 100);
          }
        }
        break;
      }

      case "cross_sell":
      case "upsell": {
        // Generates recommendations for external AI buyer discovery
        if (rule.trigger_product_ids && rule.trigger_product_ids.some(tId => productIds.includes(tId))) {
          for (const rewId of rule.reward_product_ids || rule.product_ids || []) {
            if (!productIds.includes(rewId)) {
              crossSellRecs.push({
                product_id: rewId,
                product_name: "Recommended Drop",
                discount_percent: rule.discount_percent,
                reason: rule.recommendation_reason
              });
            }
          }
        }
        break;
      }
    }

    // 3. Enforce Max Discount Cap per Rule
    if (rule.max_discount_paise && rule.max_discount_paise > 0) {
      ruleDiscountPaise = Math.min(ruleDiscountPaise, rule.max_discount_paise);
    }

    // 4. Enforce Margin Floor
    if (rule.margin_floor_percent && rule.margin_floor_percent > 0) {
      const maxAllowedDiscountPct = 100 - rule.margin_floor_percent;
      const maxAllowedDiscountPaise = Math.round((subtotalPaise * maxAllowedDiscountPct) / 100);
      if (ruleDiscountPaise > maxAllowedDiscountPaise) {
        ruleDiscountPaise = maxAllowedDiscountPaise;
      }
    }

    // Apply valid discount
    if (ruleDiscountPaise > 0) {
      // Check if this rule is non-stackable
      if (!rule.stackable && !globalPolicy?.promotion_stacking_allowed) {
        // If we already have a discount and non-stackable rule is better, take the larger
        if (ruleDiscountPaise > totalDiscountPaise) {
          // Push previous applied rules to excludedRules
          for (const prev of appliedRules) {
            excludedRules.push({
              rule_id: prev.rule_id,
              rule_name: prev.rule_name,
              rule_type: prev.rule_type,
              potential_discount_paise: prev.discount_paise,
              reason: `Non-stackable policy: Larger savings from "${rule.name}" took precedence.`
            });
          }
          totalDiscountPaise = ruleDiscountPaise;
          appliedRules.length = 0; // replace previous
          appliedRules.push({
            rule_id: rule.id,
            rule_name: rule.name,
            rule_type: rule.type,
            discount_paise: ruleDiscountPaise,
            reason: rule.recommendation_reason
          });
          hasNonStackableApplied = true;
        } else {
          excludedRules.push({
            rule_id: rule.id,
            rule_name: rule.name,
            rule_type: rule.type,
            potential_discount_paise: ruleDiscountPaise,
            reason: `Non-stackable policy: Existing applied rule provides greater or equal savings.`
          });
        }
      } else {
        totalDiscountPaise += ruleDiscountPaise;
        appliedRules.push({
          rule_id: rule.id,
          rule_name: rule.name,
          rule_type: rule.type,
          discount_paise: ruleDiscountPaise,
          reason: rule.recommendation_reason
        });
      }
    }
  }

  // Ensure total discount never exceeds subtotal
  totalDiscountPaise = Math.min(totalDiscountPaise, subtotalPaise);
  const finalTotalPaise = Math.max(0, subtotalPaise - totalDiscountPaise);

  return {
    subtotal_paise: subtotalPaise,
    discount_paise: totalDiscountPaise,
    final_total_paise: finalTotalPaise,
    buyer_savings_paise: totalDiscountPaise,
    applied_rules: appliedRules,
    excluded_rules: excludedRules,
    free_items: freeItems.length > 0 ? freeItems : undefined,
    cross_sell_recommendations: crossSellRecs.length > 0 ? crossSellRecs : undefined,
    items
  };
}

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
    max_discount_paise: 10000,
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
    min_cart_value_paise: 350000,
    discount_amount_paise: 25000,
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
    max_discount_paise: 15000,
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

