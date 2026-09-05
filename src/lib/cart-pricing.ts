import { getAdminSupabase, supabasePublic } from "@/lib/supabase";
import { getMerchantConfig, getActivePolicyVersion } from "@/lib/merchant-config";
import { evaluateGrowthRules, BuyerContext, EvaluatedItem, GrowthRule } from "@/lib/growth-engine";
import crypto from "crypto";

export interface CartPricingItemInput {
  id: string;
  quantity: number;
  size?: string;
  color?: string;
  price_paise?: number; // optional client advisory, ignored for authority
}

export interface CartPricingInput {
  items: CartPricingItemInput[];
  buyerContext?: BuyerContext;
  cartId?: string;
  policyVersion?: string;
  bidPricePaise?: number; // Negotiated bid amount in paise
  negotiatedProductId?: string; // Product ID corresponding to bidPricePaise
  bidTargetType?: "unit" | "cart"; // whether bid is per unit or for full line/cart
}

export interface PricingLineItem {
  product_id: string;
  sku?: string;
  name: string;
  unit_price_paise: number; // Authoritative price per single unit
  quantity: number; // Total delivered quantity
  paid_quantity: number; // Total paid units
  free_quantity: number; // Total free units (e.g. B3G1)
  line_subtotal_paise: number; // unit_price_paise * quantity
  line_discount_paise: number; // Discount applied to this line
  line_total_paise: number; // line_subtotal_paise - line_discount_paise
  size?: string;
  color?: string;
}

export interface AppliedRuleDetail {
  rule_id: string;
  rule_name: string;
  rule_type: string;
  discount_paise: number;
  reason: string;
}

export interface ExcludedRuleDetail {
  rule_id: string;
  rule_name: string;
  rule_type: string;
  potential_discount_paise: number;
  reason: string;
}

export interface CartPricingResult {
  lines: PricingLineItem[];
  subtotal_paise: number; // Authoritative subtotal: sum of (unit_price_paise * quantity)
  discount_paise: number; // Total discount from all applied rules / negotiation
  final_total_paise: number; // Final payable amount: subtotal_paise - discount_paise
  applied_rules: AppliedRuleDetail[];
  excluded_rules: ExcludedRuleDetail[];
  paid_quantities: Record<string, number>;
  free_quantities: Record<string, number>;
  pricing_version: string;
  buyer_savings_paise: number;
  negotiation_applied?: boolean;
  evaluated_items: EvaluatedItem[];
}

/**
 * Authoritative Server-Side Cart Pricing Engine
 * 
 * Guarantees:
 * 1. Base prices and stock are strictly fetched from Supabase catalog.
 * 2. subtotal_paise is calculated from authoritative unit prices and quantities.
 * 3. Buy 3 Get 1 Free for 4 items computes 4 delivered, 3 paid, 1 free, and final total = 3 * unit_price_paise.
 * 4. Stacking, margin floors, budget caps, and non-stackable rule exclusivity are enforced deterministically.
 * 5. final_total_paise is the complete cart total (never to be multiplied by quantity again).
 */
export async function calculateCartPricing(input: CartPricingInput): Promise<CartPricingResult> {
  const {
    items,
    buyerContext = {},
    cartId = "default_cart",
    policyVersion,
    bidPricePaise,
    negotiatedProductId,
    bidTargetType = "cart"
  } = input;

  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new Error("Invalid or empty items list provided to pricing engine");
  }

  const supabase = getAdminSupabase() || supabasePublic;
  if (!supabase) {
    throw new Error("Database client unavailable for authoritative pricing");
  }

  const productIds = items.map((it) => it.id);
  const { data: dbProducts, error } = await supabase
    .from("products")
    .select("*")
    .in("id", productIds);

  if (error || !dbProducts || dbProducts.length === 0) {
    throw new Error("Failed to retrieve authoritative products from database");
  }

  const config = getMerchantConfig();
  const activeVersion = policyVersion || getActivePolicyVersion();

  // 1. Build Evaluated Items from Authoritative DB Data
  const evaluatedItems: EvaluatedItem[] = items.map((item) => {
    const product = dbProducts.find((p) => p.id === item.id);
    if (!product) {
      throw new Error(`Product ID "${item.id}" not found in authoritative catalog`);
    }

    const qty = Math.max(1, parseInt(String(item.quantity || 1), 10));
    return {
      product: {
        id: product.id,
        name: product.name,
        price: product.price, // authoritative paise
        cost_paise: product.price * 0.4,
        stock: product.stock,
        category: product.category,
        sizes: product.sizes,
        images: product.images
      },
      quantity: qty,
      price_paise: product.price,
    };
  });

  const subtotalPaise = evaluatedItems.reduce(
    (sum, it) => sum + (it.product.price * it.quantity),
    0
  );

  // 2. Evaluate Growth Rules Deterministically
  const growthResult = evaluateGrowthRules(
    evaluatedItems,
    config.growth_rules || [],
    buyerContext,
    {
      max_discount_percent: config.policy.max_discount_percent ?? 25,
      margin_floor_percent: config.policy.margin_floor_percent ?? 60,
      max_autonomous_checkout_paise: config.policy.max_autonomous_checkout_paise,
      promotion_stacking_allowed: config.policy.promotion_stacking_allowed ?? false,
    }
  );

  let totalDiscountPaise = growthResult.discount_paise;
  const appliedRules: AppliedRuleDetail[] = growthResult.applied_rules.map((r) => ({
    rule_id: r.rule_id,
    rule_name: r.rule_name,
    rule_type: r.rule_type,
    discount_paise: r.discount_paise,
    reason: r.reason,
  }));

  const excludedRules: ExcludedRuleDetail[] = (growthResult.excluded_rules || []).map((r) => ({
    rule_id: r.rule_id,
    rule_name: r.rule_name,
    rule_type: r.rule_type,
    potential_discount_paise: r.potential_discount_paise,
    reason: r.reason,
  }));
  let negotiationApplied = false;

  // 3. Evaluate Negotiated Bid if provided
  if (bidPricePaise !== undefined && bidPricePaise !== null && bidPricePaise > 0) {
    const targetProdId = negotiatedProductId || (items.length === 1 ? items[0].id : null);
    const targetItem = evaluatedItems.find((it) => it.product.id === targetProdId);

    if (targetItem && config.policy.agent_can_negotiate) {
      const override = config.product_overrides[targetItem.product.id];
      const isNegotiable = override ? override.negotiable : true;

      if (isNegotiable) {
        const baseItemSubtotal = targetItem.product.price * targetItem.quantity;
        const maxDiscountPct = override ? override.max_discount_percent : 10;
        const minAcceptedCartPrice = Math.round(baseItemSubtotal * (1 - maxDiscountPct / 100));

        // Determine if bid was submitted as unit bid or total cart bid
        let proposedCartBid = bidPricePaise;
        if (bidTargetType === "unit" || bidPricePaise <= targetItem.product.price) {
          // If bid is <= unit price and quantity > 1, buyer bid on unit
          proposedCartBid = bidPricePaise * targetItem.quantity;
        }

        if (proposedCartBid >= minAcceptedCartPrice && proposedCartBid < baseItemSubtotal) {
          const negotiatedDiscountPaise = baseItemSubtotal - proposedCartBid;

          // Non-stackable comparison
          if (!config.policy.promotion_stacking_allowed) {
            if (negotiatedDiscountPaise > totalDiscountPaise) {
              // Exclude previously applied growth rules
              for (const prevRule of appliedRules) {
                excludedRules.push({
                  rule_id: prevRule.rule_id,
                  rule_name: prevRule.rule_name,
                  rule_type: prevRule.rule_type,
                  potential_discount_paise: prevRule.discount_paise,
                  reason: "Non-stackable policy: Larger negotiated custom discount took precedence."
                });
              }
              appliedRules.length = 0;
              appliedRules.push({
                rule_id: "rule_negotiation",
                rule_name: "Agent Direct Price Negotiation",
                rule_type: "negotiation",
                discount_paise: negotiatedDiscountPaise,
                reason: `Approved agent bid of ₹${(proposedCartBid / 100).toFixed(2)} under ${activeVersion}.`
              });
              totalDiscountPaise = negotiatedDiscountPaise;
              negotiationApplied = true;
            } else {
              excludedRules.push({
                rule_id: "rule_negotiation",
                rule_name: "Agent Direct Price Negotiation",
                rule_type: "negotiation",
                potential_discount_paise: negotiatedDiscountPaise,
                reason: "Non-stackable policy: Existing growth rule provides greater savings."
              });
            }
          } else {
            totalDiscountPaise += negotiatedDiscountPaise;
            appliedRules.push({
              rule_id: "rule_negotiation",
              rule_name: "Agent Direct Price Negotiation",
              rule_type: "negotiation",
              discount_paise: negotiatedDiscountPaise,
              reason: `Approved agent bid of ₹${(proposedCartBid / 100).toFixed(2)} under ${activeVersion}.`
            });
            negotiationApplied = true;
          }
        }
      }
    }
  }

  // 4. Enforce Global Margin Floor and Discount Cap
  const maxAllowedDiscountPct = 100 - (config.policy.margin_floor_percent ?? 60);
  const maxAllowedDiscountPaise = Math.round((subtotalPaise * maxAllowedDiscountPct) / 100);
  if (totalDiscountPaise > maxAllowedDiscountPaise) {
    totalDiscountPaise = maxAllowedDiscountPaise;
  }
  totalDiscountPaise = Math.min(totalDiscountPaise, subtotalPaise);

  const finalTotalPaise = Math.max(0, subtotalPaise - totalDiscountPaise);

  // 5. Build Quantities and Line Item Breakdown
  const paidQuantities: Record<string, number> = {};
  const freeQuantities: Record<string, number> = {};

  for (const it of evaluatedItems) {
    paidQuantities[it.product.id] = it.quantity;
    freeQuantities[it.product.id] = 0;
  }

  // Check if Buy 3 Get 1 Free was applied to allocate free quantities
  const b3g1Rule = appliedRules.find((r) => r.rule_type === "buy_x_get_y");
  if (b3g1Rule && growthResult.free_items) {
    for (const freeItem of growthResult.free_items) {
      const pId = freeItem.product_id;
      const freeQty = freeItem.free_quantity;
      if (paidQuantities[pId] !== undefined) {
        freeQuantities[pId] = freeQty;
        paidQuantities[pId] = Math.max(0, paidQuantities[pId] - freeQty);
      }
    }
  }

  const lines: PricingLineItem[] = items.map((item) => {
    const it = evaluatedItems.find((e) => e.product.id === item.id)!;
    const unitPrice = it.product.price;
    const deliveredQty = it.quantity;
    const freeQty = freeQuantities[it.product.id] || 0;
    const paidQty = paidQuantities[it.product.id] ?? deliveredQty;
    const lineSubtotal = unitPrice * deliveredQty;
    
    // Line discount attribution
    let lineDiscount = 0;
    if (freeQty > 0) {
      lineDiscount = freeQty * unitPrice;
    } else if (subtotalPaise > 0) {
      // Pro-rata discount distribution
      lineDiscount = Math.round((lineSubtotal / subtotalPaise) * totalDiscountPaise);
    }
    const lineTotal = Math.max(0, lineSubtotal - lineDiscount);

    return {
      product_id: it.product.id,
      name: it.product.name,
      unit_price_paise: unitPrice,
      quantity: deliveredQty,
      paid_quantity: paidQty,
      free_quantity: freeQty,
      line_subtotal_paise: lineSubtotal,
      line_discount_paise: lineDiscount,
      line_total_paise: lineTotal,
      size: item.size,
      color: item.color,
    };
  });

  return {
    lines,
    subtotal_paise: subtotalPaise,
    discount_paise: totalDiscountPaise,
    final_total_paise: finalTotalPaise,
    applied_rules: appliedRules,
    excluded_rules: excludedRules,
    paid_quantities: paidQuantities,
    free_quantities: freeQuantities,
    pricing_version: activeVersion,
    buyer_savings_paise: totalDiscountPaise,
    negotiation_applied: negotiationApplied,
    evaluated_items: evaluatedItems,
  };
}

/**
 * Creates a Cryptographically Signed HMAC Quote Token binding the FINAL CART TOTAL
 */
export function signQuoteToken(params: {
  productId: string;
  finalTotalPaise: number;
  size: string;
  quantity: number;
  cartId: string;
  policyVersion: string;
  expirySeconds?: number;
}): { quoteId: string; expiresAt: number } {
  const {
    productId,
    finalTotalPaise,
    size,
    quantity,
    cartId,
    policyVersion,
    expirySeconds = 900
  } = params;

  const secret = process.env.RAZORPAY_KEY_SECRET || "merchant_gateway_secret_key_1029";
  const expiresAt = Date.now() + (expirySeconds * 1000);
  
  // Signature message binds: productId : finalTotalPaise : expiresAt : size : quantity : cartId : policyVersion
  const message = `${productId}:${finalTotalPaise}:${expiresAt}:${size}:${quantity}:${cartId}:${policyVersion}`;
  const hmac = crypto.createHmac("sha256", secret).update(message).digest("hex");
  const quoteId = `quote_${Buffer.from(`${message}:${hmac}`).toString("base64")}`;

  return { quoteId, expiresAt };
}

export interface VerifiedQuote {
  valid: boolean;
  productId?: string;
  finalTotalPaise?: number;
  expiresAt?: number;
  size?: string;
  quantity?: number;
  cartId?: string;
  policyVersion?: string;
  error?: string;
}

/**
 * Cryptographically verifies quote token signature, scope, and expiry
 */
export function verifyQuoteToken(quoteId: string): VerifiedQuote {
  if (!quoteId || !quoteId.startsWith("quote_")) {
    return { valid: false, error: "INVALID_QUOTE_FORMAT" };
  }

  try {
    const token = quoteId.substring(6);
    const decoded = Buffer.from(token, "base64").toString("utf-8");
    const parts = decoded.split(":");

    if (parts.length !== 8) {
      return { valid: false, error: "MALFORMED_QUOTE_TOKEN" };
    }

    const [qProductId, qPriceStr, qExpiresStr, qSize, qQtyStr, qCartId, qVersion, qHmac] = parts;
    const secret = process.env.RAZORPAY_KEY_SECRET || "merchant_gateway_secret_key_1029";
    const verifyMessage = `${qProductId}:${qPriceStr}:${qExpiresStr}:${qSize}:${qQtyStr}:${qCartId}:${qVersion}`;
    const expectedHmac = crypto.createHmac("sha256", secret).update(verifyMessage).digest("hex");

    if (expectedHmac !== qHmac) {
      return { valid: false, error: "HMAC_SIGNATURE_MISMATCH" };
    }

    const expiresAt = parseInt(qExpiresStr, 10);
    if (Date.now() > expiresAt) {
      return { valid: false, error: "QUOTE_EXPIRED" };
    }

    return {
      valid: true,
      productId: qProductId,
      finalTotalPaise: parseInt(qPriceStr, 10),
      expiresAt,
      size: qSize,
      quantity: parseInt(qQtyStr, 10),
      cartId: qCartId,
      policyVersion: qVersion,
    };
  } catch (err: any) {
    return { valid: false, error: err?.message || "TOKEN_DECODE_FAILED" };
  }
}
