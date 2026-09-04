const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// 1. Load Supabase Environment
const envPath = path.join(__dirname, "../.env.local");
const envContent = fs.readFileSync(envPath, "utf-8");
const env = {};
envContent.split("\n").forEach(line => {
  const [k, ...v] = line.trim().split("=");
  if (k && v.length) env[k.trim()] = v.join("=").trim().replace(/^["']|["']$/g, '');
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// 2. Setup public/products folder & Copy Generated Images
const publicProductsDir = path.join(__dirname, "../public/products");
if (!fs.existsSync(publicProductsDir)) {
  fs.mkdirSync(publicProductsDir, { recursive: true });
}

const artifactDir = "C:\\Users\\aadiv\\.gemini\\antigravity-ide\\brain\\d208733a-68a1-49fa-b993-db9ef3d1792e";

const imageMappings = [
  { prefix: "argentina_sun_tee_", target: "argentina-sun-tee.png" },
  { prefix: "everyday_cargo_pants_", target: "everyday-cargo-pants.png" },
  { prefix: "court_canvas_sneakers_", target: "court-canvas-sneakers.png" },
  { prefix: "essential_street_cap_", target: "essential-street-cap.png" },
  { prefix: "utility_crossbody_sling_", target: "utility-crossbody-sling.png" },
  { prefix: "crew_socks_3_pack_", target: "crew-socks-3-pack.png" }
];

console.log("📸 [IMAGES] Copying and validating product image assets...");

const artifactFiles = fs.readdirSync(artifactDir);

imageMappings.forEach(mapping => {
  const matched = artifactFiles.filter(f => f.startsWith(mapping.prefix) && (f.endsWith(".jpg") || f.endsWith(".png")));
  if (matched.length > 0) {
    matched.sort(); // get latest
    const latestFile = matched[matched.length - 1];
    const srcPath = path.join(artifactDir, latestFile);
    const destPath = path.join(publicProductsDir, mapping.target);
    fs.copyFileSync(srcPath, destPath);
    const stat = fs.statSync(destPath);
    console.log(`✅ Copied ${latestFile} -> /products/${mapping.target} (${(stat.size / 1024).toFixed(1)} KB)`);
  } else {
    console.warn(`⚠️ No image found for ${mapping.prefix}`);
  }
});

// Save attribution manifest
fs.writeFileSync(
  path.join(publicProductsDir, "attribution.json"),
  JSON.stringify({
    source: "ZeroClick Studio Asset Generator",
    format: "1:1 Studio Product Photography",
    generated_at: new Date().toISOString(),
    assets: imageMappings.map(m => `/products/${m.target}`)
  }, null, 2),
  "utf-8"
);

// 3. Define the 6 Authoritative Demo Products
const DEMO_PRODUCTS = [
  {
    name: "Argentina Sun of May Tee",
    alt_match: "Argentina Sun Of May Tee",
    price: 64900, // ₹649
    compare_price: 90000,
    stock: 79,
    negotiable: true,
    max_discount_percent: 10,
    sizes: ["S", "M", "L", "XL"],
    colors: ["white", "navy"],
    category: "T-Shirts",
    slug: "argentina-sun-tee",
    images: ["/products/argentina-sun-tee.png"],
    description: "Vintage-inspired graphic tee celebrating Argentina with a collegiate wordmark and golden Sun of May.",
    active: true
  },
  {
    name: "Everyday Cargo Pants",
    price: 99900, // ₹999
    compare_price: 139900,
    stock: 35,
    negotiable: true,
    max_discount_percent: 8,
    sizes: ["30", "32", "34", "36"],
    colors: ["black", "olive"],
    category: "Pants",
    slug: "everyday-cargo-pants",
    images: ["/products/everyday-cargo-pants.png"],
    description: "Relaxed-fit utility streetwear cargo pants with deep flap pockets and durable cotton twill.",
    active: true
  },
  {
    name: "Court Canvas Sneakers",
    price: 149900, // ₹1,499
    compare_price: 199900,
    stock: 24,
    negotiable: false,
    max_discount_percent: 0,
    sizes: ["7", "8", "9", "10"],
    colors: ["white", "black"],
    category: "Footwear",
    slug: "court-canvas-sneakers",
    images: ["/products/court-canvas-sneakers.png"],
    description: "Classic low-top canvas court sneakers with reinforced rubber toe cap and vulcanized grip sole.",
    active: true
  },
  {
    name: "Essential Street Cap",
    price: 39900, // ₹399
    compare_price: 59900,
    stock: 50,
    negotiable: true,
    max_discount_percent: 5,
    sizes: ["One Size"],
    colors: ["black", "cream"],
    category: "Accessories",
    slug: "essential-street-cap",
    images: ["/products/essential-street-cap.png"],
    description: "Vintage washed 6-panel unstructured baseball cap with tonal embroidery and brass buckle closure.",
    active: true
  },
  {
    name: "Utility Crossbody Sling",
    price: 79900, // ₹799
    compare_price: 109900,
    stock: 18,
    negotiable: true,
    max_discount_percent: 7,
    sizes: ["One Size"],
    colors: ["black", "olive"],
    category: "Accessories",
    slug: "utility-crossbody-sling",
    images: ["/products/utility-crossbody-sling.png"],
    description: "Weather-resistant tactical crossbody sling pack with quick-release metal buckle and organizer slots.",
    active: true
  },
  {
    name: "Crew Socks 3-Pack",
    price: 24900, // ₹249
    compare_price: 39900,
    stock: 100,
    negotiable: true,
    max_discount_percent: 5,
    sizes: ["S", "M", "L"],
    colors: ["white", "black"],
    category: "Accessories",
    slug: "crew-socks-3-pack",
    images: ["/products/crew-socks-3-pack.png"],
    description: "Heavyweight ribbed cotton athletic crew socks with cushioned footbed and dual stripe detail.",
    active: true
  }
];

async function seedDatabase() {
  console.log("\n📦 [DATABASE] Querying existing Supabase products...");
  const { data: existingProducts, error: fetchErr } = await supabase.from("products").select("*");
  if (fetchErr) {
    console.error("❌ Failed to query products:", fetchErr);
    process.exit(1);
  }

  console.log(`Found ${existingProducts.length} existing products in database.`);

  const productOverrides = {};
  const resolvedProductIds = {};

  for (const item of DEMO_PRODUCTS) {
    const existing = existingProducts.find(
      p => p.name.toLowerCase() === item.name.toLowerCase() ||
           (item.alt_match && p.name.toLowerCase() === item.alt_match.toLowerCase()) ||
           p.slug === item.slug
    );

    let productId;

    if (existing) {
      console.log(`🔄 Updating existing product "${existing.name}" (ID: ${existing.id})...`);
      const { data: updated, error: upErr } = await supabase
        .from("products")
        .update({
          name: item.name,
          price: item.price,
          compare_price: item.compare_price,
          stock: item.stock,
          sizes: item.sizes,
          category: item.category,
          slug: item.slug,
          images: item.images,
          description: item.description,
          active: item.active
        })
        .eq("id", existing.id)
        .select()
        .single();

      if (upErr) {
        console.error(`❌ Failed to update product ${existing.id}:`, upErr);
      } else {
        productId = updated.id;
        console.log(`✅ Updated "${updated.name}" | Stock: ${updated.stock} | Price: ₹${updated.price / 100}`);
      }
    } else {
      console.log(`➕ Inserting new product "${item.name}"...`);
      const { data: inserted, error: inErr } = await supabase
        .from("products")
        .insert({
          name: item.name,
          price: item.price,
          compare_price: item.compare_price,
          stock: item.stock,
          sizes: item.sizes,
          category: item.category,
          slug: item.slug,
          images: item.images,
          description: item.description,
          active: item.active
        })
        .select()
        .single();

      if (inErr) {
        console.error(`❌ Failed to insert product "${item.name}":`, inErr);
      } else {
        productId = inserted.id;
        console.log(`✅ Inserted "${inserted.name}" (ID: ${inserted.id}) | Stock: ${inserted.stock} | Price: ₹${inserted.price / 100}`);
      }
    }

    if (productId) {
      resolvedProductIds[item.slug] = productId;
      productOverrides[productId] = {
        negotiable: item.negotiable,
        max_discount_percent: item.max_discount_percent
      };
    }
  }

  console.log("\n🔗 [RESOLVED PRODUCT IDS]:", JSON.stringify(resolvedProductIds, null, 2));

  // 4. Configure Active & Inactive Multi-Item Bundle Rules
  const teeId = resolvedProductIds["argentina-sun-tee"];
  const pantsId = resolvedProductIds["everyday-cargo-pants"];
  const sneakersId = resolvedProductIds["court-canvas-sneakers"];
  const capId = resolvedProductIds["essential-street-cap"];
  const slingId = resolvedProductIds["utility-crossbody-sling"];

  const bundleRules = [
    {
      id: "bundle_complete_outfit",
      name: "Complete Outfit",
      discount_percent: 10,
      active: true,
      product_ids: [teeId, pantsId],
      product_a_id: teeId,
      product_b_id: pantsId,
      recommendation_reason: "Pair the Argentina Sun Tee with Everyday Cargo Pants for a complete streetwear fit with 10% savings."
    },
    {
      id: "bundle_street_starter",
      name: "Street Starter",
      discount_percent: 8,
      active: true,
      product_ids: [teeId, sneakersId, capId],
      product_a_id: teeId,
      product_b_id: sneakersId,
      recommendation_reason: "Bundle the Tee, Court Canvas Sneakers, and Street Cap for an 8% head-to-toe combo discount."
    },
    {
      id: "bundle_carry_upgrade",
      name: "Carry Upgrade",
      discount_percent: 5,
      active: false, // INACTIVE for testing
      product_ids: [slingId, capId],
      product_a_id: slingId,
      product_b_id: capId,
      recommendation_reason: "Add a Utility Crossbody Sling and Essential Street Cap for a 5% accessory upgrade."
    }
  ];

  // 5. Update merchant-config.json
  const configPath = path.join(__dirname, "../src/data/merchant-config.json");
  let currentConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      currentConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch (e) {}
  }

  const updatedConfig = {
    policy: {
      max_autonomous_checkout_paise: currentConfig?.policy?.max_autonomous_checkout_paise || 350000, // ₹3,500
      mandate_required: currentConfig?.policy?.mandate_required ?? true,
      agent_can_recommend_bundles: currentConfig?.policy?.agent_can_recommend_bundles ?? true,
      agent_can_negotiate: currentConfig?.policy?.agent_can_negotiate ?? true,
      agent_can_checkout: currentConfig?.policy?.agent_can_checkout ?? true,
      quote_expiry_seconds: currentConfig?.policy?.quote_expiry_seconds || 600
    },
    product_overrides: {
      ...(currentConfig.product_overrides || {}),
      ...productOverrides
    },
    bundle_rules: bundleRules
  };

  fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2), "utf-8");
  console.log("✅ Updated src/data/merchant-config.json with 3 bundle rules and 6 product overrides.");

  // Also update policy snapshot
  const versionsPath = path.join(__dirname, "../src/data/policy-versions.json");
  if (fs.existsSync(versionsPath)) {
    const versions = JSON.parse(fs.readFileSync(versionsPath, "utf-8"));
    const activeVersion = versions.find(v => v.status === "active") || versions[versions.length - 1];
    if (activeVersion) {
      activeVersion.product_overrides = { ...activeVersion.product_overrides, ...productOverrides };
      activeVersion.bundle_rules = bundleRules;
      fs.writeFileSync(versionsPath, JSON.stringify(versions, null, 2), "utf-8");
      console.log(`✅ Updated active policy version snapshot (${activeVersion.version}) with new bundles and overrides.`);
    }
  }

  console.log("\n🎉 [SUCCESS] Demo catalog seeding and bundle configuration complete!");
}

seedDatabase().catch(err => {
  console.error("❌ Fatal seed error:", err);
  process.exit(1);
});
