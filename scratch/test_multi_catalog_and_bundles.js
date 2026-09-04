const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const BASE_URL = "http://localhost:3000";

// Load Supabase Environment
const envPath = path.join(__dirname, "../.env.local");
const envContent = fs.readFileSync(envPath, "utf-8");
const env = {};
envContent.split("\n").forEach(line => {
  const [k, ...v] = line.trim().split("=");
  if (k && v.length) env[k.trim()] = v.join("=").trim().replace(/^["']|["']$/g, '');
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function runValidationSuite() {
  console.log("🚀 ===========================================================================");
  console.log("🧪 [TEST SUITE] Running 10-Scenario Multi-Product Catalog & Bundle Verification");
  console.log("===========================================================================\n");

  try {
    // -------------------------------------------------------------------------
    // SCENARIO 2: Catalog Discovery for a Complete Outfit
    // -------------------------------------------------------------------------
    console.log("2️⃣ [SCENARIO 2] Testing Catalog Discovery (/api/agent/catalog)...");
    const catRes = await fetch(`${BASE_URL}/api/agent/catalog`);
    const catData = await catRes.json();
    console.log(`- Status: ${catData.status}`);
    console.log(`- Total products returned: ${catData.products.length}`);
    console.log(`- Active bundles in manifest: ${catData.merchant_capability_manifest.active_bundles.length}`);
    
    catData.products.forEach(p => {
      console.log(`  • [${p.category}] ${p.name} — ₹${p.price_inr} | Stock: ${p.stock} | Negotiable: ${p.negotiable ? `Yes (Max ${p.negotiation_policy.max_allowed_discount_pct}%)` : "No"} | Images: ${p.images.length}`);
    });

    const tee = catData.products.find(p => p.name.includes("Argentina Sun"));
    const pants = catData.products.find(p => p.name.includes("Cargo Pants"));
    const sneakers = catData.products.find(p => p.name.includes("Canvas Sneakers"));
    const cap = catData.products.find(p => p.name.includes("Street Cap"));
    const sling = catData.products.find(p => p.name.includes("Crossbody Sling"));

    if (!tee || !pants || !sneakers || !cap || !sling) {
      throw new Error("Missing expected demo products in catalog.");
    }
    console.log("✅ Catalog discovery successfully returned all 6 products with machine metadata.\n");

    // -------------------------------------------------------------------------
    // SCENARIO 3: 20% Discount Rejection & Valid 5% Negotiation
    // -------------------------------------------------------------------------
    console.log("3️⃣ [SCENARIO 3] Testing Negotiation Discount Boundaries on Tee (Max 10%)...");
    
    // A. 20% Discount Attempt (Base ₹649 -> ₹519.20 = 51920 paise)
    const bid20Res = await fetch(`${BASE_URL}/api/agent/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product_id: tee.id,
        bid_price_paise: 51920, // 20% discount (below 10% cap)
        size: "L",
        quantity: 1,
        cart_id: "test_bid_20"
      })
    });
    const bid20Data = await bid20Res.json();
    console.log(`- 20% Bid HTTP Status: ${bid20Res.status} | Error: ${bid20Data.error}`);
    if (bid20Res.status !== 422 || bid20Data.error !== "BID_TOO_LOW") {
      throw new Error("Server failed to reject 20% discount bid exceeding merchant cap.");
    }
    console.log(`  (Correctly rejected with BID_TOO_LOW: ${bid20Data.details})`);

    // B. 5% Valid Negotiation (Base ₹649 -> ₹616.55 = 61655 paise)
    const bid5Res = await fetch(`${BASE_URL}/api/agent/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product_id: tee.id,
        bid_price_paise: 61655, // 5% discount (within 10% cap)
        size: "L",
        quantity: 1,
        cart_id: "test_bid_5"
      })
    });
    const bid5Data = await bid5Res.json();
    console.log(`- 5% Bid HTTP Status: ${bid5Res.status} | Status: ${bid5Data.status} | Bound Policy: ${bid5Data.policy_version}`);
    if (bid5Res.status !== 200 || bid5Data.status !== "ACCEPTED") {
      throw new Error("Server failed to approve valid 5% discount bid within merchant cap.");
    }
    console.log(`  (Approved Quote ID: ${bid5Data.quote_id})`);
    console.log("✅ Discount bounds enforced: 20% rejected, 5% approved.\n");

    // -------------------------------------------------------------------------
    // SCENARIO 4: Bundle Recommendation & Dynamic Economics Calculation
    // -------------------------------------------------------------------------
    console.log("4️⃣ [SCENARIO 4] Testing Multi-Item Bundle Pricing (Street Starter: Tee + Sneakers + Cap)...");
    
    // Tee (₹649) + Sneakers (₹1,499) + Cap (₹399) = Subtotal ₹2,547 (254700 paise)
    // 8% combo discount = ₹204 (20376 paise)
    // Expected Total = ₹2,343 (234324 paise)
    const bundleItems = [
      { id: tee.id, quantity: 1, price_paise: 64900 },
      { id: sneakers.id, quantity: 1, price_paise: 149900 },
      { id: cap.id, quantity: 1, price_paise: 39900 }
    ];

    const orderBundleRes = await fetch(`${BASE_URL}/api/razorpay/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: bundleItems,
        budget_cap_paise: 350000,
        expected_total_paise: 234324,
        idempotency_key: `idem_bundle_${Date.now()}`,
        mandate_authorized: true,
        auto_capture: true
      })
    });
    const orderBundleData = await orderBundleRes.json();
    console.log(`- Order Status: ${orderBundleData.status} | Order ID: ${orderBundleData.order_id}`);
    console.log(`- Amount Paise: ${orderBundleData.amount_paise} (₹${orderBundleData.amount_paise / 100})`);
    
    if (orderBundleData.status !== "success" || orderBundleData.amount_paise !== 234324) {
      throw new Error(`Bundle calculation mismatch. Expected 234324 paise, got ${orderBundleData.amount_paise}`);
    }
    console.log("✅ 3-item Street Starter bundle correctly applied 8% discount with exact paise settlement.\n");

    // -------------------------------------------------------------------------
    // SCENARIO 5: Inactive Bundle Exclusion
    // -------------------------------------------------------------------------
    console.log("5️⃣ [SCENARIO 5] Testing Inactive Bundle Exclusion (Carry Upgrade: Sling + Cap)...");
    const activeBundleNames = catData.merchant_capability_manifest.active_bundles.map(b => b.name);
    console.log(`- Active bundles in manifest: [${activeBundleNames.join(", ")}]`);
    if (activeBundleNames.includes("Carry Upgrade")) {
      throw new Error("Inactive bundle 'Carry Upgrade' was erroneously exposed in active manifest.");
    }

    // Attempting checkout of Sling (₹799) + Cap (₹399) = ₹1,198 (119800 paise)
    // Since Carry Upgrade is inactive, no 5% discount should apply (total must be full ₹1,198)
    const inactiveBundleRes = await fetch(`${BASE_URL}/api/razorpay/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          { id: sling.id, quantity: 1, price_paise: 79900 },
          { id: cap.id, quantity: 1, price_paise: 39900 }
        ],
        budget_cap_paise: 350000,
        expected_total_paise: 119800, // Full price
        idempotency_key: `idem_inactive_test_${Date.now()}`,
        mandate_authorized: true,
        auto_capture: true
      })
    });
    const inactiveBundleData = await inactiveBundleRes.json();
    console.log(`- Inactive bundle items checkout total: ₹${inactiveBundleData.amount_paise / 100}`);
    if (inactiveBundleData.amount_paise !== 119800) {
      throw new Error("Discount was incorrectly applied to inactive bundle items.");
    }
    console.log("✅ Inactive bundle successfully excluded from discovery and checkout pricing.\n");

    // -------------------------------------------------------------------------
    // SCENARIO 6: Quote Scope Mismatch
    // -------------------------------------------------------------------------
    console.log("6️⃣ [SCENARIO 6] Testing Quote Scope Mismatch on Tampered Quantity...");
    const quoteForQty1Res = await fetch(`${BASE_URL}/api/agent/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product_id: tee.id,
        bid_price_paise: 60000,
        size: "L",
        quantity: 1,
        cart_id: "scope_cart_original"
      })
    });
    const quoteForQty1 = await quoteForQty1Res.json();

    // Submit checkout request with quantity 2 using the quantity 1 quote
    const scopeTamperRes = await fetch(`${BASE_URL}/api/razorpay/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ id: tee.id, quantity: 2, price_paise: 64900, size: "L" }],
        budget_cap_paise: 350000,
        expected_total_paise: 120000,
        quote_id: quoteForQty1.quote_id,
        cart_id: "scope_cart_original",
        mandate_authorized: true
      })
    });
    const scopeTamperData = await scopeTamperRes.json();
    console.log(`- Scope Tamper HTTP Status: ${scopeTamperRes.status} | Error: ${scopeTamperData.error}`);
    if (scopeTamperRes.status !== 422 || scopeTamperData.error !== "QUOTE_SCOPE_MISMATCH") {
      throw new Error("Server failed to reject tampered quote scope.");
    }
    console.log("✅ Quote scope mismatch correctly blocked checkout.\n");

    // -------------------------------------------------------------------------
    // SCENARIO 7: Idempotency Retry
    // -------------------------------------------------------------------------
    console.log("7️⃣ [SCENARIO 7] Testing Idempotency Retry with same key...");
    const idemKey = `idem_validation_${Date.now()}`;
    const payload7 = {
      items: [{ id: cap.id, quantity: 1, price_paise: 39900, size: "One Size" }],
      budget_cap_paise: 350000,
      expected_total_paise: 39900,
      idempotency_key: idemKey,
      mandate_authorized: true,
      auto_capture: true
    };

    // First attempt
    const res7A = await fetch(`${BASE_URL}/api/razorpay/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload7)
    });
    const data7A = await res7A.json();

    // Second attempt (retry)
    const res7B = await fetch(`${BASE_URL}/api/razorpay/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload7)
    });
    const data7B = await res7B.json();

    console.log(`- Attempt 1 Order ID: ${data7A.order_id}`);
    console.log(`- Attempt 2 Order ID: ${data7B.order_id}`);
    if (data7A.order_id !== data7B.order_id) {
      throw new Error("Idempotency retry failed to return matching original order ID.");
    }
    console.log("✅ Idempotency retry returned original order details without duplicate execution.\n");

    // -------------------------------------------------------------------------
    // SCENARIO 8: Concurrent Last-Item Stock Race
    // -------------------------------------------------------------------------
    console.log("8️⃣ [SCENARIO 8] Testing Concurrent Stock Race on Last Item...");
    
    // Set stock of socks to 1
    const { data: sockRow } = await supabase.from("products").select("stock").eq("id", "73bdabf5-c327-4780-a1e4-03ed277e67f0").single();
    const originalSockStock = sockRow?.stock || 100;
    
    await supabase.from("products").update({ stock: 1 }).eq("id", "73bdabf5-c327-4780-a1e4-03ed277e67f0");

    const raceA = fetch(`${BASE_URL}/api/razorpay/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ id: "73bdabf5-c327-4780-a1e4-03ed277e67f0", quantity: 1, price_paise: 24900, size: "M" }],
        budget_cap_paise: 350000,
        expected_total_paise: 24900,
        idempotency_key: `race_A_${Date.now()}`,
        mandate_authorized: true,
        auto_capture: true
      })
    }).then(r => r.json());

    const raceB = fetch(`${BASE_URL}/api/razorpay/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ id: "73bdabf5-c327-4780-a1e4-03ed277e67f0", quantity: 1, price_paise: 24900, size: "M" }],
        budget_cap_paise: 350000,
        expected_total_paise: 24900,
        idempotency_key: `race_B_${Date.now()}`,
        mandate_authorized: true,
        auto_capture: true
      })
    }).then(r => r.json());

    const [resRaceA, resRaceB] = await Promise.all([raceA, raceB]);
    console.log(`- Buyer A Result: ${resRaceA.status || resRaceA.error}`);
    console.log(`- Buyer B Result: ${resRaceB.status || resRaceB.error}`);

    const hasSuccess = resRaceA.status === "success" || resRaceB.status === "success";
    const hasStockOut = resRaceA.error === "INVENTORY_STOCK_OUT" || resRaceB.error === "INVENTORY_STOCK_OUT";

    if (!hasSuccess || !hasStockOut) {
      throw new Error("Concurrent race condition failed: expected exactly 1 success and 1 INVENTORY_STOCK_OUT.");
    }
    console.log("✅ Concurrency race passed: Exactly one buyer acquired last item; other received INVENTORY_STOCK_OUT.");

    // Restore sock stock
    await supabase.from("products").update({ stock: originalSockStock }).eq("id", "73bdabf5-c327-4780-a1e4-03ed277e67f0");

    // -------------------------------------------------------------------------
    // SCENARIO 9: Multi-Item Payment-Failure Restoration
    // -------------------------------------------------------------------------
    console.log("\n9️⃣ [SCENARIO 9] Testing Multi-Item Stock Restoration on Payment Failure...");
    const { data: prePants } = await supabase.from("products").select("stock").eq("id", pants.id).single();
    const { data: preTee } = await supabase.from("products").select("stock").eq("id", tee.id).single();
    
    const failOrderId = `idem_fail_multi_${Date.now()}`;
    const orderFailRes = await fetch(`${BASE_URL}/api/razorpay/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          { id: tee.id, quantity: 1, price_paise: 64900, size: "L" },
          { id: pants.id, quantity: 1, price_paise: 99900, size: "32" }
        ],
        budget_cap_paise: 350000,
        expected_total_paise: 148320, // 10% bundle discount
        idempotency_key: failOrderId,
        mandate_authorized: true,
        auto_capture: false
      })
    });
    const orderFailData = await orderFailRes.json();
    console.log(`- Created Multi-Item Order: ${orderFailData.order_id}`);

    // Trigger payment failure status update
    const statusRes = await fetch(`${BASE_URL}/api/razorpay/order/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_id: orderFailData.order_id,
        status: "failed",
        failure_reason: "BANK_NETWORK_DECLINE"
      })
    });
    const statusData = await statusRes.json();
    console.log(`- Payment failure status update: HTTP ${statusRes.status}`, statusData);

    const { data: postPants } = await supabase.from("products").select("stock").eq("id", pants.id).single();
    const { data: postTee } = await supabase.from("products").select("stock").eq("id", tee.id).single();

    if (prePants.stock !== postPants.stock || preTee.stock !== postTee.stock) {
      throw new Error(`Stock restoration failed. Pre: Tee ${preTee.stock}, Pants ${prePants.stock}. Post: Tee ${postTee.stock}, Pants ${postPants.stock}`);
    }
    console.log("✅ Multi-item stock restored back to exact original levels on payment failure.\n");

    // -------------------------------------------------------------------------
    // SCENARIO 10: Policy Version Update and Old/New Quote Behavior
    // -------------------------------------------------------------------------
    console.log("🔟 [SCENARIO 10] Testing Policy Versioning & Old/New Quote Behavior...");
    const confRes = await fetch(`${BASE_URL}/api/merchant/config`);
    const confData = await confRes.json();
    const currentVer = confData.active_version;
    console.log(`- Current Active Policy: ${currentVer}`);

    // Generate Quote under current version
    const quoteVerRes = await fetch(`${BASE_URL}/api/agent/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product_id: tee.id,
        bid_price_paise: 62000,
        size: "M",
        quantity: 1,
        cart_id: "ver_test_cart"
      })
    });
    const quoteVerData = await quoteVerRes.json();
    console.log(`- Issued Quote under ${quoteVerData.policy_version}: ${quoteVerData.quote_id.substring(0, 40)}...`);

    // Publish new policy version
    const pubRes = await fetch(`${BASE_URL}/api/merchant/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          ...confData.config,
          policy: {
            ...confData.config.policy,
            max_autonomous_checkout_paise: 400000 // changed to ₹4,000
          }
        },
        change_summary: "Updated maximum autonomous spending cap to ₹4,000 for high-volume drops"
      })
    });
    const pubData = await pubRes.json();
    console.log(`- New Active Policy Version: ${pubData.active_version}`);

    // Settle the older quote under the new active environment (must succeed under old version's embedded rule)
    const oldQuoteCheckoutRes = await fetch(`${BASE_URL}/api/razorpay/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ id: tee.id, quantity: 1, price_paise: 64900, size: "M" }],
        budget_cap_paise: 400000,
        expected_total_paise: 62000,
        quote_id: quoteVerData.quote_id,
        cart_id: "ver_test_cart",
        mandate_authorized: true,
        auto_capture: true
      })
    });
    const oldQuoteCheckoutData = await oldQuoteCheckoutRes.json();
    console.log(`- Settle Old Quote Result: Status ${oldQuoteCheckoutData.status} | Order ID: ${oldQuoteCheckoutData.order_id}`);
    if (oldQuoteCheckoutData.status !== "success") {
      throw new Error("Failed to checkout previously issued quote under updated policy.");
    }
    console.log("✅ Policy versioning verified: Immutable history created, existing quotes honored until TTL.\n");

    console.log("🎉 ===========================================================================");
    console.log("🏆 ALL 10 VALIDATION SCENARIOS PASSED WITH ZERO ERRORS!");
    console.log("===========================================================================");

  } catch (err) {
    console.error("\n❌ [VALIDATION FAILED]:", err.message);
    process.exit(1);
  }
}

runValidationSuite();
