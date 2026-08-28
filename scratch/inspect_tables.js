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

async function checkTables() {
  console.log("Checking for bundle_rules table...");
  const { data: bRules, error: bError } = await supabase.from("bundle_rules").select("*").limit(1);
  console.log("bundle_rules exists:", !bError);

  console.log("Checking for merchant_policies table...");
  const { data: mPol, error: mError } = await supabase.from("merchant_policies").select("*").limit(1);
  console.log("merchant_policies exists:", !mError);
}

checkTables();
