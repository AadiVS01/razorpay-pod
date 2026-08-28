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

async function testStockRecovery() {
  console.log("🧪 [TEST] Running payment failure stock recovery test...");

  const productId = "977da225-f3ed-46a0-abf1-4ae18739e1a1";
  const size = "L";
  const quantity = 1;
  const cartId = "test_recovery_cart";
  const idempotencyKey = `idem_fail_${Date.now()}`;

  const checkoutPayload = {
    items: [{ id: productId, quantity: quantity, price_paise: 64900, size, color: "Cream" }],
    budget_cap_paise: 200000,
    expected_total_paise: 64900,
    auto_capture: true,
    cart_id: cartId,
    mandate_authorized: true,
    idempotency_key: idempotencyKey
  };

  try {
    // 1. Fetch stock before checkout
    const catalogRes1 = await fetch("http://localhost:3000/api/agent/catalog");
    const catalogData1 = await catalogRes1.json();
    const prodBefore = catalogData1.products.find(p => p.id === productId);
    const stockStart = prodBefore.stock;
    console.log(`- Start stock level: ${stockStart}`);

    // 2. Perform checkout (decrements stock by 1)
    console.log("- Performing checkout...");
    const checkoutRes = await fetch("http://localhost:3000/api/razorpay/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(checkoutPayload)
    });
    const checkoutJson = await checkoutRes.json();
    const orderId = checkoutJson.order_id;
    console.log(`  Checkout succeeded. Created Order ID: ${orderId}`);

    // 3. Fetch stock after checkout
    const catalogRes2 = await fetch("http://localhost:3000/api/agent/catalog");
    const catalogData2 = await catalogRes2.json();
    const prodAfterCheckout = catalogData2.products.find(p => p.id === productId);
    console.log(`- Stock level after checkout: ${prodAfterCheckout.stock}`);

    if (stockStart - prodAfterCheckout.stock !== 1) {
      throw new Error(`Checkout did not decrement stock correctly.`);
    }

    // 4. Fail the order (POST to status API) to restore stock
    console.log(`- Triggering payment failure for Order ID: ${orderId}...`);
    const statusFailRes = await fetch("http://localhost:3000/api/razorpay/order/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_id: orderId,
        status: "failed"
      })
    });
    const failJson = await statusFailRes.json();
    console.log(`  Status update returned:`, failJson);

    // 5. Fetch stock after failure restoration
    const catalogRes3 = await fetch("http://localhost:3000/api/agent/catalog");
    const catalogData3 = await catalogRes3.json();
    const prodRestored = catalogData3.products.find(p => p.id === productId);
    console.log(`- Stock level after failure restoration: ${prodRestored.stock}`);

    // 6. Assertions
    if (prodRestored.stock !== stockStart) {
      console.error("❌ [FAIL] FAILURE: Stock was not restored back to original level on payment failure.");
      process.exit(1);
    }

    console.log("✅ [PASS] SUCCESS: Stock recovery completed. Stock restored back to original level exactly once!");
    process.exit(0);

  } catch (err) {
    console.error("❌ [TEST_ERROR] Test execution failed:", err.message);
    process.exit(1);
  }
}

testStockRecovery();
