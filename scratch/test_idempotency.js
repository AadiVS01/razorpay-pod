const crypto = require("crypto");
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

const secret = env.RAZORPAY_KEY_SECRET || "merchant_gateway_secret_key_1029";

async function testIdempotency() {
  console.log("🧪 [TEST] Running checkout idempotency test...");

  const productId = "977da225-f3ed-46a0-abf1-4ae18739e1a1";
  const size = "L";
  const quantity = 1;
  const cartId = "test_idem_cart";
  const idempotencyKey = `idem_key_${Date.now()}`;

  // Payload
  const checkoutPayload = {
    items: [
      {
        id: productId,
        quantity: quantity,
        price_paise: 64900,
        size: size,
        color: "Cream"
      }
    ],
    budget_cap_paise: 200000,
    expected_total_paise: 64900,
    auto_capture: true,
    cart_id: cartId,
    mandate_authorized: true, // Authorized consent mandate
    idempotency_key: idempotencyKey
  };

  try {
    // 1. Fetch current stock
    const catalogRes1 = await fetch("http://localhost:3000/api/agent/catalog");
    const catalogData1 = await catalogRes1.json();
    const prod1 = catalogData1.products.find(p => p.id === productId);
    const stockBefore = prod1.stock;
    console.log(`- Stock level before first checkout: ${stockBefore}`);

    // 2. Trigger first checkout
    console.log("- Triggering first checkout...");
    const res1 = await fetch("http://localhost:3000/api/razorpay/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(checkoutPayload)
    });
    const json1 = await res1.json();
    console.log(`  First response Order ID: ${json1.order_id}`);

    // 3. Fetch current stock after first checkout
    const catalogRes2 = await fetch("http://localhost:3000/api/agent/catalog");
    const catalogData2 = await catalogRes2.json();
    const prod2 = catalogData2.products.find(p => p.id === productId);
    const stockAfter1 = prod2.stock;
    console.log(`- Stock level after first checkout: ${stockAfter1}`);

    if (stockBefore - stockAfter1 !== 1) {
      throw new Error(`First checkout should decrement stock by 1, but got difference: ${stockBefore - stockAfter1}`);
    }

    // 4. Trigger second checkout with identical payload & idempotency key
    console.log("- Triggering second checkout (idem retry)...");
    const res2 = await fetch("http://localhost:3000/api/razorpay/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(checkoutPayload)
    });
    const json2 = await res2.json();
    console.log(`  Second response Order ID: ${json2.order_id}`);

    // 5. Fetch current stock after second checkout
    const catalogRes3 = await fetch("http://localhost:3000/api/agent/catalog");
    const catalogData3 = await catalogRes3.json();
    const prod3 = catalogData3.products.find(p => p.id === productId);
    const stockAfter2 = prod3.stock;
    console.log(`- Stock level after second checkout: ${stockAfter2}`);

    // Assertions
    if (json1.order_id !== json2.order_id) {
      console.error("❌ [FAIL] FAILURE: Idempotent retries returned different order IDs.");
      process.exit(1);
    }

    if (stockAfter1 !== stockAfter2) {
      console.error("❌ [FAIL] FAILURE: Stock decremented a second time on idempotent retry.");
      process.exit(1);
    }

    console.log("✅ [PASS] SUCCESS: Idempotency returned original order details and did not double-decrement stock!");
    process.exit(0);

  } catch (err) {
    console.error("❌ [TEST_ERROR] Test execution failed:", err.message);
    process.exit(1);
  }
}

testIdempotency();
