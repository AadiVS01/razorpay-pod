const { createClient } = require("@supabase/supabase-js");
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

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function testAtomicUpdate() {
  const productId = "977da225-f3ed-46a0-abf1-4ae18739e1a1"; // Argentina Tee ID

  console.log("Fetching current stock...");
  const { data: prodBefore } = await supabase
    .from("products")
    .select("stock")
    .eq("id", productId)
    .single();
  
  const currentStock = prodBefore.stock;
  console.log(`Current stock: ${currentStock}`);

  // Try updating with gte constraint matching current stock
  console.log("Executing conditional update...");
  const { data, error, count, status } = await supabase
    .from("products")
    .update({ stock: currentStock - 1 })
    .eq("id", productId)
    .gte("stock", 1) // Only update if stock >= 1
    .select(); // Select forces returned row data

  if (error) {
    console.error("Update error:", error);
  } else {
    console.log("Update status:", status);
    console.log("Updated rows count:", data ? data.length : 0);
    console.log("Updated rows data:", data);
  }

  // Restore stock back
  console.log("Restoring stock back...");
  await supabase
    .from("products")
    .update({ stock: currentStock })
    .eq("id", productId);
}

testAtomicUpdate();
