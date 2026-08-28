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

async function inspectSchema() {
  console.log("Checking products table...");
  const { data: products, error: pError } = await supabase.from("products").select("*").limit(1);
  if (pError) console.error("Products error:", pError);
  else console.log("Products sample row columns:", products[0] ? Object.keys(products[0]) : "No rows");

  console.log("Checking orders table...");
  const { data: orders, error: oError } = await supabase.from("orders").select("*").limit(1);
  if (oError) console.error("Orders error:", oError);
  else console.log("Orders sample row columns:", orders[0] ? Object.keys(orders[0]) : "No rows");
}

inspectSchema();
