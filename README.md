# ZeroClick: Autonomous Agent-to-Agent (A2A) Commerce Control Plane

[![Next.js 15](https://img.shields.io/badge/Next.js-15.5-black?style=flat&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=flat&logo=typescript)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Database-Supabase-emerald?style=flat&logo=supabase)](https://supabase.com/)
[![Razorpay](https://img.shields.io/badge/Payments-Razorpay%20A2A-blue?style=flat&logo=razorpay)](https://razorpay.com/)

**ZeroClick** is a production-hardened **Merchant Revenue Control Plane & Gateway** for autonomous AI-buyer commerce. It enables merchants to configure products, dynamic bundle rules, discount limits, mandate requirements, quote expiry TTLs, and spending caps. AI buyer agents discover catalog drops, negotiate within deterministic boundaries, and execute end-to-end checkout with zero human holds or approval queues.

Every transaction is governed by **8 server-side security gates**, logged into an immutable **Trust Ledger**, and auditable via explainable **"Why this decision?"** traces.

---

## 🏗️ System Architecture

```mermaid
sequenceDiagram
    autonumber
    actor Customer as 👤 Human Buyer
    participant Buyer as 🤖 AI Buyer Agent
    participant Gateway as 🛡️ ZeroClick Gateway (/api)
    participant Engine as ⚙️ Merchant Policy Engine
    database DB as 🗄️ Supabase DB
    participant RZP as 💳 Razorpay Payments

    Customer->>Buyer: "Buy Complete Outfit (Tee + Cargo Pants) under ₹1,800"
    Buyer->>Gateway: Discovery Query (GET /api/agent/catalog)
    Gateway-->>Buyer: 6 Products + Active Bundles + Capability Manifest
    Buyer->>Gateway: Negotiate Price (POST /api/agent/quote)
    Gateway->>Engine: Evaluate Discount Bounds & Policy Version
    Engine-->>Gateway: Quote Token Signed (HMAC-SHA256 bound to Cart + TTL)
    Gateway-->>Buyer: Approved Quote Token + Policy Snapshot
    Buyer->>Gateway: Autonomous Checkout (POST /api/razorpay/order)
    Gateway->>Engine: Run 8 Server-Side Safety Gates
    alt All 8 Gates Pass
        Gateway->>DB: Atomic Conditional Stock Decrement (gte stock, qty)
        Gateway->>RZP: Issue Razorpay Order / Pre-Auth Payment
        Gateway->>DB: Log Idempotency Key & Order Row
        Gateway-->>Buyer: Order Success (Exact Signed Quote Match, ₹0 Hidden Fees)
        Buyer-->>Customer: "Complete Outfit secured! Order confirmed."
    else Policy / Budget / Stock Violation
        Gateway-->>Buyer: Deterministic Error (e.g. BUDGET_CAP_EXCEEDED, INVENTORY_STOCK_OUT)
        Buyer-->>Customer: "Checkout rejected by merchant revenue policy."
    end
```

---

## 🛡️ The 8 Deterministic Server-Side Safety Gates

| # | Security Gate | Mechanism & Threat Neutralization | Error Code |
|---|---|---|---|
| **1** | **Autonomy Permission Gate** | Global merchant master switch controlling autonomous checkout permissions. | `AUTONOMY_DISABLED` |
| **2** | **Mandate Consent Gate** | Enforces consent-based UPI Mandate / Reserve Pay pre-authorization. | `MANDATE_REQUIRED` |
| **3** | **HMAC Quote Signature & TTL** | Cryptographically verifies quote token signature and enforces expiry TTL (default: 900s). | `PRICE_MISMATCH` |
| **4** | **Quote Scope Matching** | Binds product ID, quantity, size variant, and cart hash. Rejects scope tampering. | `QUOTE_SCOPE_MISMATCH` |
| **5** | **Price & Bundle Integrity** | Authoritative database recalculation of subtotal and active multi-item combo discounts. | `PRICE_MISMATCH` |
| **6** | **Autonomous Budget Cap** | Rejects any order exceeding the merchant's configured spending cap limit. | `BUDGET_CAP_EXCEEDED` |
| **7** | **Atomic Inventory Allocation** | Concurrency-safe conditional SQL update (`gte("stock", qty)`). Prevents double-selling. | `INVENTORY_STOCK_OUT` |
| **8** | **Idempotency & Recovery** | Unique idempotency key constraint ensures repeat requests return original orders; exactly-once stock restoration on failure. | `IDEMPOTENT_REUSE` |

---

## 🎛️ Merchant Control Center Workspace

The dashboard is organized into four clean sections:

1. **Overview & Telemetry**: High-level store metrics, revenue captured, protected revenue from blocked violations, and active drop counts.
2. **Catalog & Bundles**: Full product inventory with studio photography thumbnails, stock counts, category tags, negotiation toggles, discount ceilings, and multi-bundle live economics preview (subtotal, combo discount, buyer savings, incremental merchant revenue).
3. **Agent Policy & Versioning**: Immutable policy snapshots (`v1`, `v2`, ...), quote expiry TTL settings, budget caps, pre-publish diff modals, and zero-mutation rollback.
4. **Activity & Trust Ledger**: Chronological journey grouping (`session_id`, `cart_id`, `quote_id`, `order_id`) with explainable **"Why this decision?"** trace drawers displaying buyer intent, exact arithmetic, gate outcomes, and business results.

---

## 🔌 Machine-Readable API Suite

### 1. Catalog Discovery: `GET /api/agent/catalog`
Returns structured JSON drops, inventory stock, variants, studio image URLs, and the **Merchant Capability Manifest**.

### 2. Cryptographic Quote Negotiation: `POST /api/agent/quote`
Evaluates agent bid against merchant category discount limits and issues an HMAC-SHA256 token embedding product ID, price, size, quantity, cart ID, expiry timestamp, and active policy version.

### 3. Autonomous Checkout: `POST /api/razorpay/order`
Evaluates all 8 safety gates, conditionally decrements inventory, and issues Razorpay payment orders with exact paise precision.

### 4. Durable Trust Ledger: `GET /api/agent/ledger`
Returns complete audit event telemetry and journey session traces.

### 5. OpenAPI Specification: `GET /api/openapi.json`
Complete OpenAPI 3.0 specification for custom AI agents, GPT Actions, and MCP bridges.

### 6. Protocol Compatibility Adapters: `POST /api/protocol/adapter`
Provides protocol-shaped demo envelopes for:
- `acp-shaped` (`acp-agentic-commerce-draft`)
- `ap2-shaped` (`ap2-mandate-commerce`)
- `x402-shaped` (`x402-http-payment-required`)

---

## 📦 Demo Catalog & Active Bundle Rules

| Product | Base Price | Stock | Negotiable | Max Discount | Studio Photography |
|---|---|---|---|---|---|
| **Argentina Sun of May Tee** | ₹649 | 79 | Yes | 10% | `/products/argentina-sun-tee.png` |
| **Everyday Cargo Pants** | ₹999 | 35 | Yes | 8% | `/products/everyday-cargo-pants.png` |
| **Court Canvas Sneakers** | ₹1,499 | 24 | No | 0% | `/products/court-canvas-sneakers.png` |
| **Essential Street Cap** | ₹399 | 50 | Yes | 5% | `/products/essential-street-cap.png` |
| **Utility Crossbody Sling** | ₹799 | 18 | Yes | 7% | `/products/utility-crossbody-sling.png` |
| **Crew Socks 3-Pack** | ₹249 | 100 | Yes | 5% | `/products/crew-socks-3-pack.png` |

### Active Bundle Deals
- **Complete Outfit** (Tee + Cargo Pants): **10% Combo Discount** $\to$ ₹1,483.20 (Save ₹165)
- **Street Starter** (Tee + Sneakers + Cap): **8% Combo Discount** $\to$ ₹2,343.24 (Save ₹204)
- *Carry Upgrade* (Sling + Cap): 5% Discount (*Inactive test bundle*)

---

## 🚀 Getting Started

### 1. Prerequisites
- Node.js 18+
- pnpm (`npm install -g pnpm`)
- Supabase project & Razorpay test keys

### 2. Environment Configuration (`.env.local`)
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
RAZORPAY_KEY_ID=rzp_test_your_key_id
RAZORPAY_KEY_SECRET=your_key_secret
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

### 3. Install & Seed
```bash
# Install dependencies
pnpm install

# Seed authoritative products and bundle rules
node scratch/seed_catalog.js

# Start development server
pnpm dev
```

### 4. Build & Production
```bash
# Compile optimized production bundle
pnpm build

# Start production server
pnpm start
```

---

## 🧪 Comprehensive Regression Suite

ZeroClick includes an automated test suite covering all safety rails:

```bash
# 1. Exact amount matching & ₹0 hidden fees
node scratch/test_amount_match.js

# 2. Scope tampering rejection (Quantity / Cart mismatch)
node scratch/test_scope_mismatch.js

# 3. Checkout idempotency & zero duplicate stock decrements
node scratch/test_idempotency.js

# 4. Concurrency race condition on last remaining item
node scratch/test_concurrent_stock.js

# 5. Multi-item payment failure stock restoration
node scratch/test_stock_recovery.js

# 6. Policy versioning immutability & protocol adapters
node scratch/test_policy_versions_and_adapters.js

# 7. Complete 10-scenario end-to-end regression suite
node scratch/test_multi_catalog_and_bundles.js
```

---

## 📄 License
MIT License. Built for autonomous AI commerce.
