const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Manually parse .env.local
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

async function runRegressionTest() {
  console.log("🧪 [TEST] Running Razorpay amount matching regression test...");

  // Mock a product checkout for Argentina Tee (₹649 base)
  const productId = "977da225-f3ed-46a0-abf1-4ae18739e1a1";
  const agreedPricePaise = 60000; // ₹600 (negotiated)
  const size = "L";
  const quantity = 1;
  const cartId = "test_regression_cart";
  const expiresAt = Date.now() + 5 * 60 * 1000;

  // Generate cryptographically signed quote token
  const verifyMessage = `${productId}:${agreedPricePaise}:${expiresAt}:${size}:${quantity}:${cartId}`;
  const hmac = crypto.createHmac("sha256", secret).update(verifyMessage).digest("hex");
  const quoteId = `quote_${Buffer.from(`${verifyMessage}:${hmac}`).toString("base64")}`;

  console.log(`- Created Quote ID: ${quoteId}`);
  console.log(`- Expected amount at checkout: ₹${agreedPricePaise / 100}`);

  // Perform mock request payload
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
    budget_cap_paise: 70000,
    expected_total_paise: agreedPricePaise,
    auto_capture: true,
    quote_id: quoteId,
    cart_id: cartId,
    idempotency_key: `test_idempotency_${Date.now()}`
  };

  try {
    // Send request to local Next.js dev server if running, or run the handler code directly.
    // For direct regression testing, let's call the endpoint on localhost:3000
    const res = await fetch("http://localhost:3000/api/razorpay/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(checkoutPayload)
    });

    const json = await res.json();
    if (res.status !== 200) {
      throw new Error(`Checkout endpoint failed with status ${res.status}: ${JSON.stringify(json)}`);
    }

    console.log(`- Gateway returned amount: ₹${json.amount_paise / 100}`);

    if (json.amount_paise !== agreedPricePaise) {
      console.error(`❌ [FAIL] REGRESSION FAILURE: Razorpay amount (${json.amount_paise}) does not match approved quote total (${agreedPricePaise}).`);
      process.exit(1);
    }

    console.log("✅ [PASS] REGRESSION SUCCESS: Checkout amount matches approved quote total exactly!");
  } catch (err) {
    console.error("❌ [TEST_ERROR] Test execution failed:", err.message);
    console.log("⚠️ (Make sure Next.js dev server 'pnpm dev' is running on port 3000 to execute network assertion.)");
  }
}

runRegressionTest();
