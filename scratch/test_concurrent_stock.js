const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "../.env.local");
const envContent = fs.readFileSync(envPath, "utf-8");
const env = {};
envContent.split("\n").forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || "";
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    env[match[1]] = value;
  }
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL || "", env.SUPABASE_SERVICE_ROLE_KEY || "");

async function testConcurrentStock() {
  console.log("🧪 [TEST] Running concurrent stock allocation race test...");

  const productId = "977da225-f3ed-46a0-abf1-4ae18739e1a1";
  const size = "L";

  // 1. Fetch current stock and save it
  const { data: prod } = await supabase.from("products").select("stock").eq("id", productId).single();
  const originalStock = prod.stock;
  console.log(`- Original stock: ${originalStock}`);

  try {
    // 2. Set stock to exactly 1
    console.log("- Setting product stock to 1 for race condition testing...");
    await supabase.from("products").update({ stock: 1 }).eq("id", productId);

    // 3. Prepare two checkouts
    const payloadA = {
      items: [{ id: productId, quantity: 1, price_paise: 64900, size, color: "Cream" }],
      budget_cap_paise: 200000,
      expected_total_paise: 64900,
      auto_capture: true,
      mandate_authorized: true,
      idempotency_key: `concurrent_A_${Date.now()}`
    };

    const payloadB = {
      items: [{ id: productId, quantity: 1, price_paise: 64900, size, color: "Cream" }],
      budget_cap_paise: 200000,
      expected_total_paise: 64900,
      auto_capture: true,
      mandate_authorized: true,
      idempotency_key: `concurrent_B_${Date.now()}`
    };

    console.log("- Triggering 2 checkout requests concurrently...");
    
    const [resA, resB] = await Promise.all([
      fetch("http://localhost:3000/api/razorpay/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadA)
      }),
      fetch("http://localhost:3000/api/razorpay/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadB)
      })
    ]);

    const jsonA = await resA.json();
    const jsonB = await resB.json();

    console.log(`  Checkout A: Status ${resA.status} | Response:`, jsonA);
    console.log(`  Checkout B: Status ${resB.status} | Response:`, jsonB);

    // Check assertions
    const successA = resA.status === 200 && jsonA.status === "success";
    const successB = resB.status === 200 && jsonB.status === "success";

    const stockOutA = resA.status === 422 && jsonA.error === "INVENTORY_STOCK_OUT";
    const stockOutB = resB.status === 422 && jsonB.error === "INVENTORY_STOCK_OUT";

    if ((successA && stockOutB) || (successB && stockOutA)) {
      console.log("✅ [PASS] SUCCESS: Exactly one checkout succeeded and the other safely received INVENTORY_STOCK_OUT!");
    } else {
      console.error("❌ [FAIL] FAILURE: Concurrent checkouts behaved incorrectly (either both succeeded or both failed).");
      process.exit(1);
    }

  } catch (err) {
    console.error("❌ [TEST_ERROR] Test execution failed:", err.message);
    process.exit(1);
  } finally {
    // 4. Restore original stock back
    console.log("- Restoring stock level back to original...");
    await supabase.from("products").update({ stock: originalStock }).eq("id", productId);
    process.exit(0);
  }
}

testConcurrentStock();
