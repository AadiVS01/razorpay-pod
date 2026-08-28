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

async function testScopeMismatch() {
  console.log("🧪 [TEST] Running quote scope mismatch regression test...");

  const productId = "977da225-f3ed-46a0-abf1-4ae18739e1a1";
  const agreedPricePaise = 60000; // ₹600
  const size = "L";
  const quoteQuantity = 1; // Signed for quantity = 1
  const cartId = "test_scope_mismatch_cart";
  const expiresAt = Date.now() + 5 * 60 * 1000;

  // Generate cryptographically signed quote token with v1 policy version suffix
  const verifyMessage = `${productId}:${agreedPricePaise}:${expiresAt}:${size}:${quoteQuantity}:${cartId}:v1`;
  const hmac = crypto.createHmac("sha256", secret).update(verifyMessage).digest("hex");
  const quoteId = `quote_${Buffer.from(`${verifyMessage}:${hmac}`).toString("base64")}`;

  console.log(`- Created Quote ID for Qty ${quoteQuantity}: ${quoteId}`);

  // Tamper checkout payload: checkout with quantity = 2 using the Qty 1 quote
  const checkoutPayload = {
    items: [
      {
        id: productId,
        quantity: 2, // Tampered quantity!
        price_paise: 64900,
        size: size,
        color: "Cream"
      }
    ],
    budget_cap_paise: 200000,
    expected_total_paise: agreedPricePaise * 2,
    auto_capture: true,
    quote_id: quoteId,
    cart_id: cartId,
    mandate_authorized: true, // Authorized consent mandate
    idempotency_key: `test_scope_idem_${Date.now()}`
  };

  try {
    const res = await fetch("http://localhost:3000/api/razorpay/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(checkoutPayload)
    });

    const json = await res.json();
    console.log(`- Gateway returned status: ${res.status}`);
    console.log(`- Gateway returned response:`, json);

    if (res.status === 422 && json.error === "QUOTE_SCOPE_MISMATCH") {
      console.log("✅ [PASS] SUCCESS: Server correctly blocked checkout with QUOTE_SCOPE_MISMATCH!");
      process.exit(0);
    } else {
      console.error("❌ [FAIL] FAILURE: Server did not reject tampered quantity scope.");
      process.exit(1);
    }
  } catch (err) {
    console.error("❌ [TEST_ERROR] Test execution failed:", err.message);
  }
}

testScopeMismatch();
