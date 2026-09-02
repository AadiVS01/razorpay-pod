"use client";

import React, { useState, useEffect } from "react";
import {
  Shield,
  Sparkles,
  Check,
  RefreshCw,
  AlertTriangle,
  RotateCcw,
  Eye,
  Info,
  Layers,
  ArrowRight,
  TrendingUp,
  PackageCheck,
  Activity,
  ChevronRight,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink
} from "lucide-react";
import { MerchantConfig, MerchantPolicy, BundleRule, ProductOverride, PolicyVersionSnapshot } from "@/lib/merchant-config";
import { AgentJourney, AuditEvent } from "@/lib/audit-ledger";

interface ProductRow {
  id: string;
  name: string;
  price_paise: number;
  stock: number;
  active: boolean;
  category: string;
  negotiable: boolean;
  max_discount_percent: number;
  sizes: string[];
  colors: string[];
}

type TabType = "overview" | "catalog" | "policy" | "activity";

export const MerchantControlCenter: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>("overview");
  const [config, setConfig] = useState<MerchantConfig | null>(null);
  const [activeVersion, setActiveVersion] = useState<string>("v1");
  const [policyVersions, setPolicyVersions] = useState<(PolicyVersionSnapshot & { quote_count: number })[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Stats
  const [todayRevenue, setTodayRevenue] = useState(0);
  const [todayOrders, setTodayOrders] = useState(0);
  const [blockedActions, setBlockedActions] = useState(0);
  const [stockIncidents, setStockIncidents] = useState(0);
  const [totalBuyerSavings, setTotalBuyerSavings] = useState(0);
  const [ledgerEvents, setLedgerEvents] = useState<AuditEvent[]>([]);
  const [journeys, setJourneys] = useState<AgentJourney[]>([]);

  // Modals & Search
  const [selectedTrace, setSelectedTrace] = useState<AgentJourney["trace"] | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState<PolicyVersionSnapshot | null>(null);
  const [ledgerFilter, setLedgerFilter] = useState<string>("");

  // Fetch current configs, versions, products, and ledger
  const loadConfigAndProducts = async () => {
    setLoading(true);
    try {
      // 1. Load Policies, overrides, bundles, and immutable versions
      const configRes = await fetch("/api/merchant/config");
      const configData = await configRes.json();

      // 2. Load live products from catalog to get authoritative stock/price
      const catalogRes = await fetch("/api/agent/catalog");
      const catalogData = await catalogRes.json();

      if (configData.status === "success" && catalogData.status === "success") {
        setConfig(configData.config);
        setActiveVersion(configData.active_version || "v1");
        setPolicyVersions(configData.versions || []);

        const mergedProducts: ProductRow[] = catalogData.products.map((p: any) => {
          const override = configData.config.product_overrides[p.id] || { negotiable: true, max_discount_percent: 10 };
          return {
            id: p.id,
            name: p.name,
            price_paise: p.price_paise,
            stock: p.stock,
            active: p.in_stock !== false,
            category: p.category,
            negotiable: override.negotiable,
            max_discount_percent: override.max_discount_percent,
            sizes: p.sizes || [],
            colors: p.colors || []
          };
        });
        setProducts(mergedProducts);
      }

      // 3. Query ledger for events and grouped journeys
      const ledgerRes = await fetch("/api/agent/ledger");
      const ledgerData = await ledgerRes.json();
      if (ledgerData.status === "success") {
        const events = ledgerData.events || [];
        const completed = events.filter((e: any) => e.outcome === "COMPLETED");
        const rev = completed.reduce((acc: number, cur: any) => acc + (cur.amount_after || 0), 0);
        const blocked = events.filter((e: any) => e.policy_result === "BLOCKED").length;
        const stockOuts = events.filter((e: any) => e.reason_code === "OUT_OF_STOCK").length;
        const savings = completed.reduce((acc: number, cur: any) => {
          if (cur.amount_before && cur.amount_after && cur.amount_before > cur.amount_after) {
            return acc + (cur.amount_before - cur.amount_after);
          }
          return acc;
        }, 0);

        setTodayRevenue(rev);
        setTodayOrders(completed.length);
        setBlockedActions(blocked);
        setStockIncidents(stockOuts);
        setTotalBuyerSavings(savings);
        setLedgerEvents(events);
        setJourneys(ledgerData.journeys || []);
      }
    } catch (err: any) {
      console.error("Failed to load merchant center data:", err);
      setErrorMsg("Failed to synchronize merchant center settings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfigAndProducts();
  }, []);

  const handleUpdatePolicy = (field: keyof MerchantPolicy, value: any) => {
    if (!config) return;
    setConfig({
      ...config,
      policy: {
        ...config.policy,
        [field]: value
      }
    });
  };

  const handleUpdateOverride = (productId: string, field: keyof ProductOverride, value: any) => {
    if (!config) return;
    const current = config.product_overrides[productId] || { negotiable: true, max_discount_percent: 10 };
    setConfig({
      ...config,
      product_overrides: {
        ...config.product_overrides,
        [productId]: {
          ...current,
          [field]: value
        }
      }
    });
    setProducts(products.map(p => p.id === productId ? { ...p, [field]: value } : p));
  };

  const handleProductLocalChange = (productId: string, field: keyof ProductRow, value: any) => {
    setProducts(products.map(p => p.id === productId ? { ...p, [field]: value } : p));
  };

  const handleUpdateBundle = (field: keyof BundleRule, value: any) => {
    if (!config || !config.bundle_rules[0]) return;
    const updated = [...config.bundle_rules];
    updated[0] = {
      ...updated[0],
      [field]: value
    };
    setConfig({
      ...config,
      bundle_rules: updated
    });
  };

  const handleSaveAll = async (customSummary?: string) => {
    if (!config) return;
    setSaving(true);
    setMessage(null);
    setErrorMsg(null);

    // Guard: Prevent same-product bundle pairing
    const bundle = config.bundle_rules[0];
    if (bundle && bundle.product_a_id === bundle.product_b_id) {
      setErrorMsg("Invalid Bundle Pairing: Product A and Product B cannot be the same product.");
      setSaving(false);
      return;
    }

    try {
      const res = await fetch("/api/merchant/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config,
          products,
          change_summary: customSummary
        })
      });

      const data = await res.json();
      if (data.status === "success") {
        setMessage(`Settings saved! Active policy version: ${data.active_version || "updated"}`);
        setTimeout(() => setMessage(null), 4000);
        loadConfigAndProducts();
      } else {
        setErrorMsg(data.details || "Validation failed.");
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to transmit policy overrides.");
    } finally {
      setSaving(false);
    }
  };

  const handleRollback = async (versionTag: string) => {
    if (!confirm(`Are you sure you want to rollback to policy version ${versionTag}? A new immutable version will be created preserving history.`)) {
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/merchant/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rollback_version: versionTag })
      });
      const data = await res.json();
      if (data.status === "success") {
        setMessage(data.message);
        setTimeout(() => setMessage(null), 4000);
        loadConfigAndProducts();
      } else {
        setErrorMsg(data.details || "Rollback failed.");
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to rollback version.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-16 text-foreground font-mono text-sm space-y-4">
        <RefreshCw className="w-8 h-8 animate-spin text-foreground" />
        <span className="font-bold uppercase tracking-wider">Synchronizing Merchant Revenue Control Plane...</span>
      </div>
    );
  }

  const activeProductsCount = products.filter(p => p.active).length;
  const bundle = config?.bundle_rules[0];

  const filteredEvents = ledgerEvents.filter(e => {
    if (!ledgerFilter) return true;
    const q = ledgerFilter.toLowerCase();
    return (
      e.action.toLowerCase().includes(q) ||
      (e.order_id || "").toLowerCase().includes(q) ||
      (e.quote_id || "").toLowerCase().includes(q) ||
      (e.reason_code || "").toLowerCase().includes(q) ||
      (e.details || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6 font-mono text-xs text-foreground max-w-7xl mx-auto pb-12">
      
      {/* ================= TOP NAVIGATION BAR ================= */}
      <div className="bg-background border-2 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse" />
          <div>
            <h1 className="text-base font-black uppercase tracking-tight">Merchant Control Center</h1>
            <p className="text-[11px] text-muted-foreground uppercase font-bold">
              Active Policy: <span className="bg-foreground text-background px-1.5 py-0.5 font-black">{activeVersion}</span> | Autonomous Safety Rails Active
            </p>
          </div>
        </div>

        {/* Action button */}
        <div className="flex items-center space-x-3">
          {message && (
            <span className="text-xs bg-emerald-100 text-emerald-800 border border-emerald-500 px-2 py-1 font-bold animate-fade-in">
              {message}
            </span>
          )}
          {errorMsg && (
            <span className="text-xs bg-rose-100 text-rose-800 border border-rose-500 px-2 py-1 font-bold">
              {errorMsg}
            </span>
          )}
          <button
            onClick={() => handleSaveAll()}
            disabled={saving}
            className="flex items-center space-x-2 bg-foreground text-background px-4 py-2 font-black text-xs uppercase hover:bg-muted-foreground transition-all disabled:opacity-50 border-2 border-foreground shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            <span>{saving ? "Deploying Policy..." : "Deploy Active Policy"}</span>
          </button>
        </div>
      </div>

      {/* ================= 4 CLEAN SECTION TABS ================= */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <button
          onClick={() => setActiveTab("overview")}
          className={`p-3 font-black text-xs uppercase border-2 border-foreground text-left transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] ${
            activeTab === "overview" ? "bg-foreground text-background" : "bg-background text-foreground hover:bg-muted/20"
          }`}
        >
          <div className="flex items-center justify-between">
            <span>1. Overview</span>
            <TrendingUp className="w-4 h-4" />
          </div>
          <span className="text-[10px] font-normal block mt-1 opacity-80">Store health & economics</span>
        </button>

        <button
          onClick={() => setActiveTab("catalog")}
          className={`p-3 font-black text-xs uppercase border-2 border-foreground text-left transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] ${
            activeTab === "catalog" ? "bg-foreground text-background" : "bg-background text-foreground hover:bg-muted/20"
          }`}
        >
          <div className="flex items-center justify-between">
            <span>2. Catalog & Bundles</span>
            <PackageCheck className="w-4 h-4" />
          </div>
          <span className="text-[10px] font-normal block mt-1 opacity-80">{activeProductsCount} active products & rules</span>
        </button>

        <button
          onClick={() => setActiveTab("policy")}
          className={`p-3 font-black text-xs uppercase border-2 border-foreground text-left transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] ${
            activeTab === "policy" ? "bg-foreground text-background" : "bg-background text-foreground hover:bg-muted/20"
          }`}
        >
          <div className="flex items-center justify-between">
            <span>3. Agent Policy</span>
            <Shield className="w-4 h-4" />
          </div>
          <span className="text-[10px] font-normal block mt-1 opacity-80">Caps, gates & {policyVersions.length} versions</span>
        </button>

        <button
          onClick={() => setActiveTab("activity")}
          className={`p-3 font-black text-xs uppercase border-2 border-foreground text-left transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] ${
            activeTab === "activity" ? "bg-foreground text-background" : "bg-background text-foreground hover:bg-muted/20"
          }`}
        >
          <div className="flex items-center justify-between">
            <span>4. Activity & Ledger</span>
            <Activity className="w-4 h-4" />
          </div>
          <span className="text-[10px] font-normal block mt-1 opacity-80">Journeys & decision traces</span>
        </button>
      </div>

      {/* ================= TAB 1: OVERVIEW ================= */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Key Metric Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-background border-2 border-foreground p-4 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
              <span className="text-[10px] text-muted-foreground uppercase font-black">Store Status</span>
              <div className="flex items-center space-x-2 mt-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-sm font-black uppercase">Live Active</span>
              </div>
            </div>

            <div className="bg-background border-2 border-foreground p-4 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
              <span className="text-[10px] text-muted-foreground uppercase font-black">Active Products</span>
              <p className="text-xl font-black mt-2">{activeProductsCount} / {products.length}</p>
            </div>

            <div className="bg-background border-2 border-foreground p-4 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
              <span className="text-[10px] text-muted-foreground uppercase font-black">Captured Revenue</span>
              <p className="text-xl font-black mt-2">₹{todayRevenue} <span className="text-xs text-muted-foreground font-normal">({todayOrders} orders)</span></p>
            </div>

            <div className="bg-background border-2 border-foreground p-4 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
              <span className="text-[10px] text-muted-foreground uppercase font-black">Avg Order Value</span>
              <p className="text-xl font-black mt-2">₹{todayOrders > 0 ? Math.round(todayRevenue / todayOrders) : 0}</p>
            </div>

            <div className="bg-background border-2 border-foreground p-4 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
              <span className="text-[10px] text-muted-foreground uppercase font-black">Policy Protection</span>
              <p className="text-xl font-black mt-2 text-emerald-600">{blockedActions} Blocked</p>
            </div>

            <div className="bg-background border-2 border-foreground p-4 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
              <span className="text-[10px] text-muted-foreground uppercase font-black">Buyer Savings</span>
              <p className="text-xl font-black mt-2 text-indigo-600">₹{totalBuyerSavings}</p>
            </div>
          </div>

          {/* Core System Architecture Overview */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-background border-2 border-foreground p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] space-y-4">
              <h2 className="text-sm font-black uppercase tracking-wider border-b-2 border-foreground pb-2 flex items-center justify-between">
                <span>Autonomous Merchant Control Plane Architecture</span>
                <span className="bg-muted px-2 py-0.5 text-[10px] font-black">Zero-Click AI Commerce</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                <div className="border border-foreground p-3 bg-muted/10 space-y-2">
                  <span className="font-black uppercase text-[11px] block border-b border-border pb-1">1. Discovery Layer</span>
                  <p className="text-muted-foreground leading-relaxed">
                    AI agents query <code className="bg-muted px-1">/api/agent/catalog</code> to discover authoritative prices, active bundles, and protocol capability manifests.
                  </p>
                </div>
                <div className="border border-foreground p-3 bg-muted/10 space-y-2">
                  <span className="font-black uppercase text-[11px] block border-b border-border pb-1">2. Negotiation Engine</span>
                  <p className="text-muted-foreground leading-relaxed">
                    Discounts bounded by merchant maximums. Accepted bids receive HMAC-signed quote tokens binding product, qty, cart hash, and policy version.
                  </p>
                </div>
                <div className="border border-foreground p-3 bg-muted/10 space-y-2">
                  <span className="font-black uppercase text-[11px] block border-b border-border pb-1">3. Autonomous Rails</span>
                  <p className="text-muted-foreground leading-relaxed">
                    Razorpay order creation with zero human approvals. Guaranteed by atomic Postgres decrement, budget cap checks, and unique idempotency keys.
                  </p>
                </div>
              </div>

              {/* Quick Navigation Cards */}
              <div className="pt-2 flex flex-wrap gap-3">
                <button
                  onClick={() => setActiveTab("catalog")}
                  className="border-2 border-foreground px-3 py-2 font-bold text-xs uppercase hover:bg-foreground hover:text-background transition-colors flex items-center space-x-1"
                >
                  <span>Configure Catalog & Bundles</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setActiveTab("policy")}
                  className="border-2 border-foreground px-3 py-2 font-bold text-xs uppercase hover:bg-foreground hover:text-background transition-colors flex items-center space-x-1"
                >
                  <span>Adjust Policy Caps & Versions</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setActiveTab("activity")}
                  className="border-2 border-foreground px-3 py-2 font-bold text-xs uppercase hover:bg-foreground hover:text-background transition-colors flex items-center space-x-1"
                >
                  <span>Inspect Decision Traces</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Quick Status Sidebar */}
            <div className="bg-background border-2 border-foreground p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] space-y-4">
              <h2 className="text-sm font-black uppercase tracking-wider border-b-2 border-foreground pb-2">
                Active Policy Snapshot ({activeVersion})
              </h2>
              {config && (
                <div className="space-y-3 font-mono text-xs">
                  <div className="flex justify-between border-b border-border pb-1.5">
                    <span className="text-muted-foreground">Autonomous Budget Cap:</span>
                    <span className="font-black">₹{config.policy.max_autonomous_checkout_paise / 100}</span>
                  </div>
                  <div className="flex justify-between border-b border-border pb-1.5">
                    <span className="text-muted-foreground">Quote Expiry Window:</span>
                    <span className="font-black">{config.policy.quote_expiry_seconds}s (10 min)</span>
                  </div>
                  <div className="flex justify-between border-b border-border pb-1.5">
                    <span className="text-muted-foreground">Mandate Consent Gate:</span>
                    <span className={`font-black ${config.policy.mandate_required ? "text-emerald-600" : "text-amber-600"}`}>
                      {config.policy.mandate_required ? "ENFORCED" : "OPTIONAL"}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-border pb-1.5">
                    <span className="text-muted-foreground">Bundle Upsells:</span>
                    <span className="font-black">{config.policy.agent_can_recommend_bundles ? "ALLOWED" : "MUTED"}</span>
                  </div>
                  <div className="flex justify-between pb-1">
                    <span className="text-muted-foreground">Active Bundle Discount:</span>
                    <span className="font-black text-indigo-600">{bundle?.discount_percent || 15}% OFF</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB 2: CATALOG & BUNDLES ================= */}
      {activeTab === "catalog" && (
        <div className="space-y-6">
          {/* Authoritative Product Table */}
          <div className="bg-background border-2 border-foreground p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] space-y-4">
            <div className="border-b-2 border-foreground pb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-black uppercase tracking-wider">Authoritative Product Catalog</h2>
                <p className="text-[11px] text-muted-foreground">Directly updates the authoritative PostgreSQL/Supabase database schema on deploy.</p>
              </div>
              <span className="bg-muted border border-foreground px-2 py-1 text-[10px] font-black uppercase">
                {activeProductsCount} Active Products in Live Feed
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse border border-foreground text-xs">
                <thead>
                  <tr className="bg-muted/50 uppercase tracking-widest text-[10px] border-b-2 border-foreground font-black">
                    <th className="p-2.5 border-r border-foreground">Product Name</th>
                    <th className="p-2.5 border-r border-foreground">Category</th>
                    <th className="p-2.5 border-r border-foreground">Base Price (₹)</th>
                    <th className="p-2.5 border-r border-foreground">Stock Units</th>
                    <th className="p-2.5 border-r border-foreground">Negotiable</th>
                    <th className="p-2.5 border-r border-foreground">Max Discount</th>
                    <th className="p-2.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id} className="border-b border-foreground/30 hover:bg-muted/20">
                      <td className="p-2.5 border-r border-foreground font-bold">
                        <input
                          type="text"
                          value={p.name}
                          onChange={(e) => handleProductLocalChange(p.id, "name", e.target.value)}
                          className="w-full bg-background border border-border px-2 py-1 font-bold focus:outline-none"
                        />
                      </td>
                      <td className="p-2.5 border-r border-foreground text-muted-foreground uppercase text-[11px]">
                        {p.category || "Apparel"}
                      </td>
                      <td className="p-2.5 border-r border-foreground font-bold">
                        <div className="flex items-center space-x-1">
                          <span>₹</span>
                          <input
                            type="number"
                            value={Math.round(p.price_paise / 100)}
                            onChange={(e) => handleProductLocalChange(p.id, "price_paise", parseInt(e.target.value || "0") * 100)}
                            className="w-20 bg-background border border-border px-2 py-1 font-bold focus:outline-none"
                          />
                        </div>
                      </td>
                      <td className="p-2.5 border-r border-foreground font-bold">
                        <input
                          type="number"
                          value={p.stock}
                          onChange={(e) => handleProductLocalChange(p.id, "stock", parseInt(e.target.value || "0"))}
                          className="w-16 bg-background border border-border px-2 py-1 font-bold focus:outline-none"
                        />
                      </td>
                      <td className="p-2.5 border-r border-foreground text-center">
                        <button
                          onClick={() => handleUpdateOverride(p.id, "negotiable", !p.negotiable)}
                          className="border border-foreground px-2 py-1 font-black text-[10px] uppercase hover:bg-muted/30"
                        >
                          {p.negotiable ? "YES" : "NO"}
                        </button>
                      </td>
                      <td className="p-2.5 border-r border-foreground">
                        <div className="flex items-center space-x-1">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            disabled={!p.negotiable}
                            value={p.max_discount_percent}
                            onChange={(e) => handleUpdateOverride(p.id, "max_discount_percent", parseInt(e.target.value || "0"))}
                            className="w-14 bg-background border border-border px-2 py-1 font-bold focus:outline-none disabled:opacity-40"
                          />
                          <span>%</span>
                        </div>
                      </td>
                      <td className="p-2.5">
                        <button
                          onClick={() => handleProductLocalChange(p.id, "active", !p.active)}
                          className="focus:outline-none"
                        >
                          {p.active ? (
                            <span className="px-2 py-1 bg-foreground text-background text-[10px] font-black uppercase">ACTIVE</span>
                          ) : (
                            <span className="px-2 py-1 bg-rose-500 text-white text-[10px] font-black uppercase">INACTIVE</span>
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Outfit Bundle Configurator */}
          <div className="bg-background border-2 border-foreground p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] space-y-4">
            <h2 className="text-sm font-black uppercase tracking-wider border-b-2 border-foreground pb-2">
              Outfit Bundle Pairing & Live Economics Calculator
            </h2>

            {bundle ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] uppercase font-black text-muted-foreground mb-1">Bundle Rule Name</label>
                    <input
                      type="text"
                      value={bundle.name}
                      onChange={(e) => handleUpdateBundle("name", e.target.value)}
                      className="w-full bg-background border-2 border-foreground p-2 font-bold focus:outline-none text-xs"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] uppercase font-black text-muted-foreground mb-1">Product A (Main Piece)</label>
                      <select
                        value={bundle.product_a_id}
                        onChange={(e) => handleUpdateBundle("product_a_id", e.target.value)}
                        className="w-full bg-background border-2 border-foreground p-2 font-bold text-xs focus:outline-none"
                      >
                        {products.map(p => (
                          <option key={p.id} value={p.id} disabled={p.id === bundle.product_b_id}>
                            {p.name} (₹{Math.round(p.price_paise / 100)}) {p.id === bundle.product_b_id ? "— (Already Product B)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] uppercase font-black text-muted-foreground mb-1">Product B (Matching Add-On)</label>
                      <select
                        value={bundle.product_b_id}
                        onChange={(e) => handleUpdateBundle("product_b_id", e.target.value)}
                        className="w-full bg-background border-2 border-foreground p-2 font-bold text-xs focus:outline-none"
                      >
                        {products.map(p => (
                          <option key={p.id} value={p.id} disabled={p.id === bundle.product_a_id}>
                            {p.name} (₹{Math.round(p.price_paise / 100)}) {p.id === bundle.product_a_id ? "— (Already Product A)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase font-black text-muted-foreground mb-1">Recommendation Reason (Agent Copy)</label>
                    <input
                      type="text"
                      value={bundle.recommendation_reason || ""}
                      onChange={(e) => handleUpdateBundle("recommendation_reason", e.target.value)}
                      placeholder="Why should the agent recommend this combo?"
                      className="w-full bg-background border-2 border-foreground p-2 font-bold focus:outline-none text-xs"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] uppercase font-black text-muted-foreground mb-1">Bundle Discount (%)</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={bundle.discount_percent}
                        onChange={(e) => handleUpdateBundle("discount_percent", parseInt(e.target.value || "0"))}
                        className="w-full bg-background border-2 border-foreground p-2 font-bold focus:outline-none text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-black text-muted-foreground mb-1">Bundle Promotion Status</label>
                      <button
                        onClick={() => handleUpdateBundle("active", !bundle.active)}
                        className={`w-full border-2 border-foreground py-2 font-black text-xs uppercase transition-colors ${
                          bundle.active ? "bg-foreground text-background" : "bg-background text-foreground hover:bg-muted/20"
                        }`}
                      >
                        {bundle.active ? "Enabled (Live)" : "Disabled (Muted)"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Dynamic Economics Live Computation */}
                {(() => {
                  const prodA = products.find(p => p.id === bundle.product_a_id);
                  const prodB = products.find(p => p.id === bundle.product_b_id);
                  const priceA = prodA ? Math.round(prodA.price_paise / 100) : 649;
                  const priceB = prodB ? Math.round(prodB.price_paise / 100) : 549;
                  const individualTotal = priceA + priceB;
                  const discountAmt = Math.round((individualTotal * bundle.discount_percent) / 100);
                  const bundleTotal = individualTotal - discountAmt;
                  const buyerSavings = discountAmt;
                  const incrementalRevenue = bundleTotal - priceA;

                  return (
                    <div className="border-2 border-dashed border-foreground p-4 bg-muted/20 flex flex-col justify-between space-y-4">
                      <div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Dynamic Economics Preview</span>
                        <div className="space-y-2 font-mono text-xs mt-3">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">{prodA?.name || "Product A"} (₹{priceA}) + {prodB?.name || "Product B"} (₹{priceB}):</span>
                            <span className="font-bold">₹{individualTotal}</span>
                          </div>
                          <div className="flex justify-between border-b border-border pb-2">
                            <span className="text-muted-foreground">Bundle Total ({bundle.discount_percent}% off combo):</span>
                            <span className="font-black text-base">₹{bundleTotal}</span>
                          </div>
                          <div className="flex justify-between text-emerald-600 font-bold">
                            <span>Buyer Direct Savings:</span>
                            <span>₹{buyerSavings}</span>
                          </div>
                          <div className="flex justify-between text-indigo-600 font-black">
                            <span>Merchant Captured Revenue:</span>
                            <span>₹{bundleTotal}</span>
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-foreground/30 pt-3 text-[11px] text-muted-foreground uppercase leading-relaxed">
                        <strong className="text-foreground">Revenue Expansion Story:</strong> Delivering this pairing boosts captured basket size by <span className="text-indigo-600 font-black">+₹{incrementalRevenue}</span> (+{Math.round((incrementalRevenue / priceA) * 100)}%) compared to selling {prodA?.name || "the single item"} alone.
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <p className="text-muted-foreground">No bundle rule defined.</p>
            )}
          </div>
        </div>
      )}

      {/* ================= TAB 3: AGENT POLICY ================= */}
      {activeTab === "policy" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Global Policy Parameters */}
            <div className="lg:col-span-1 bg-background border-2 border-foreground p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] space-y-4">
              <h2 className="text-sm font-black uppercase tracking-wider border-b-2 border-foreground pb-2 flex items-center justify-between">
                <span>Autonomous Policy Boundaries</span>
                <Shield className="w-4 h-4" />
              </h2>

              {config && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] uppercase font-black text-muted-foreground mb-1">
                      Max Autonomous Checkout Cap (₹)
                    </label>
                    <input
                      type="number"
                      value={Math.round(config.policy.max_autonomous_checkout_paise / 100)}
                      onChange={(e) => handleUpdatePolicy("max_autonomous_checkout_paise", parseInt(e.target.value || "0") * 100)}
                      className="w-full bg-background border-2 border-foreground p-2 font-black text-sm focus:outline-none"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Orders above this amount are blocked deterministically.
                    </p>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase font-black text-muted-foreground mb-1">
                      Quote Expiry Window (Seconds)
                    </label>
                    <input
                      type="number"
                      value={config.policy.quote_expiry_seconds}
                      onChange={(e) => handleUpdatePolicy("quote_expiry_seconds", parseInt(e.target.value || "600"))}
                      className="w-full bg-background border-2 border-foreground p-2 font-black text-sm focus:outline-none"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">
                      HMAC quote signature validity. Standard: 600s (10 min).
                    </p>
                  </div>

                  {/* Toggle switches */}
                  <div className="space-y-2 pt-2 border-t border-border">
                    <label className="flex items-center justify-between p-2 border border-foreground hover:bg-muted/20 cursor-pointer">
                      <span className="font-bold uppercase text-[11px]">Require UPI Mandate Consent</span>
                      <input
                        type="checkbox"
                        checked={config.policy.mandate_required}
                        onChange={(e) => handleUpdatePolicy("mandate_required", e.target.checked)}
                        className="w-4 h-4"
                      />
                    </label>

                    <label className="flex items-center justify-between p-2 border border-foreground hover:bg-muted/20 cursor-pointer">
                      <span className="font-bold uppercase text-[11px]">Allow Bundle Recommendations</span>
                      <input
                        type="checkbox"
                        checked={config.policy.agent_can_recommend_bundles}
                        onChange={(e) => handleUpdatePolicy("agent_can_recommend_bundles", e.target.checked)}
                        className="w-4 h-4"
                      />
                    </label>

                    <label className="flex items-center justify-between p-2 border border-foreground hover:bg-muted/20 cursor-pointer">
                      <span className="font-bold uppercase text-[11px]">Allow Price Negotiation</span>
                      <input
                        type="checkbox"
                        checked={config.policy.agent_can_negotiate}
                        onChange={(e) => handleUpdatePolicy("agent_can_negotiate", e.target.checked)}
                        className="w-4 h-4"
                      />
                    </label>

                    <label className="flex items-center justify-between p-2 border border-foreground hover:bg-muted/20 cursor-pointer">
                      <span className="font-bold uppercase text-[11px]">Allow Autonomous Checkout</span>
                      <input
                        type="checkbox"
                        checked={config.policy.agent_can_checkout}
                        onChange={(e) => handleUpdatePolicy("agent_can_checkout", e.target.checked)}
                        className="w-4 h-4"
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* Right: Policy Versions Table */}
            <div className="lg:col-span-2 bg-background border-2 border-foreground p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] space-y-4">
              <div className="border-b-2 border-foreground pb-2 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-black uppercase tracking-wider">Immutable Policy Versions</h2>
                  <p className="text-[11px] text-muted-foreground">Historical snapshots are immutable. Rollbacks generate new active versions.</p>
                </div>
                <span className="bg-foreground text-background px-2 py-0.5 text-[10px] font-black uppercase">
                  {policyVersions.length} Recorded Versions
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse border border-foreground text-xs">
                  <thead>
                    <tr className="bg-muted/50 uppercase tracking-widest text-[10px] border-b-2 border-foreground font-black">
                      <th className="p-2.5 border-r border-foreground">Version</th>
                      <th className="p-2.5 border-r border-foreground">Created Date</th>
                      <th className="p-2.5 border-r border-foreground">Change Summary</th>
                      <th className="p-2.5 border-r border-foreground">Status</th>
                      <th className="p-2.5 border-r border-foreground text-center">Quotes Issued</th>
                      <th className="p-2.5 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {policyVersions.map((v) => (
                      <tr key={v.version} className={`border-b border-foreground/30 ${v.status === "active" ? "bg-muted/30 font-bold" : "hover:bg-muted/10"}`}>
                        <td className="p-2.5 border-r border-foreground font-black">
                          <span className={v.status === "active" ? "bg-foreground text-background px-1.5 py-0.5" : ""}>
                            {v.version}
                          </span>
                        </td>
                        <td className="p-2.5 border-r border-foreground text-muted-foreground text-[11px]">
                          {new Date(v.created_at).toLocaleDateString()} {new Date(v.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="p-2.5 border-r border-foreground max-w-xs text-[11px] truncate" title={v.change_summary}>
                          {v.change_summary}
                        </td>
                        <td className="p-2.5 border-r border-foreground">
                          {v.status === "active" ? (
                            <span className="px-2 py-0.5 bg-emerald-500 text-white font-black text-[9px] uppercase">ACTIVE</span>
                          ) : (
                            <span className="px-2 py-0.5 bg-muted text-muted-foreground font-bold text-[9px] uppercase">SUPERSEDED</span>
                          )}
                        </td>
                        <td className="p-2.5 border-r border-foreground text-center font-black">
                          {v.quote_count || 0}
                        </td>
                        <td className="p-2.5 text-center space-x-2">
                          <button
                            onClick={() => setSelectedSnapshot(v)}
                            className="border border-foreground px-2 py-0.5 font-bold text-[10px] uppercase hover:bg-foreground hover:text-background"
                          >
                            View
                          </button>
                          {v.status !== "active" && (
                            <button
                              onClick={() => handleRollback(v.version)}
                              className="border border-foreground bg-amber-500/20 px-2 py-0.5 font-black text-[10px] uppercase hover:bg-amber-500 hover:text-white"
                            >
                              Rollback
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB 4: ACTIVITY & LEDGER ================= */}
      {activeTab === "activity" && (
        <div className="space-y-6">
          {/* Section 1: Grouped Agent Activity Journeys */}
          <div className="bg-background border-2 border-foreground p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] space-y-4">
            <div className="border-b-2 border-foreground pb-2 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-black uppercase tracking-wider">Grouped Agent Activity Journeys</h2>
                <p className="text-[11px] text-muted-foreground">End-to-end sessions connecting catalog discovery, bundle upsells, negotiation, and settlement.</p>
              </div>
              <span className="bg-foreground text-background px-2 py-0.5 text-[10px] font-black uppercase">
                {journeys.length} Transaction Sessions
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {journeys.slice(0, 6).map((j) => (
                <div key={j.journey_id} className="border-2 border-foreground p-4 bg-muted/10 space-y-3 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-muted-foreground font-black truncate max-w-[180px]">
                        ID: {j.journey_id}
                      </span>
                      <span className={`px-2 py-0.5 font-black text-[9px] uppercase ${
                        j.status === "COMPLETED" ? "bg-emerald-500 text-white" :
                        j.status === "BLOCKED" ? "bg-rose-500 text-white" : "bg-muted text-foreground"
                      }`}>
                        {j.status}
                      </span>
                    </div>

                    <p className="font-bold text-xs leading-tight">{j.intent_summary}</p>

                    <div className="flex items-center space-x-2 text-[11px] text-muted-foreground">
                      <span>Policy: <strong>{j.policy_version}</strong></span>
                      <span>•</span>
                      <span>Total: <strong>₹{j.final_amount || 649}</strong></span>
                      <span>•</span>
                      <span>{j.events.length} Events Logged</span>
                    </div>
                  </div>

                  <button
                    onClick={() => setSelectedTrace(j.trace)}
                    className="w-full border border-foreground py-1.5 font-black text-[10px] uppercase hover:bg-foreground hover:text-background transition-colors flex items-center justify-center space-x-1"
                  >
                    <span>Inspect "Why this decision?" Trace</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Section 2: Searchable Durable Trust Ledger */}
          <div className="bg-background border-2 border-foreground p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] space-y-4">
            <div className="border-b-2 border-foreground pb-2 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-black uppercase tracking-wider">Durable Trust Ledger Audit Log</h2>
                <p className="text-[11px] text-muted-foreground">Every cryptographic quote and autonomous gateway action persisted to disk.</p>
              </div>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Filter by order, quote, action..."
                  value={ledgerFilter}
                  onChange={(e) => setLedgerFilter(e.target.value)}
                  className="bg-background border-2 border-foreground pl-8 pr-3 py-1 font-bold text-xs focus:outline-none w-64"
                />
              </div>
            </div>

            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-left border-collapse border border-foreground text-xs">
                <thead className="sticky top-0 bg-muted border-b-2 border-foreground z-10">
                  <tr className="uppercase tracking-widest text-[9px] font-black">
                    <th className="p-2 border-r border-foreground">Timestamp</th>
                    <th className="p-2 border-r border-foreground">Actor</th>
                    <th className="p-2 border-r border-foreground">Action</th>
                    <th className="p-2 border-r border-foreground">Reference IDs</th>
                    <th className="p-2 border-r border-foreground">Policy Ver</th>
                    <th className="p-2 border-r border-foreground">Amount (INR)</th>
                    <th className="p-2 border-r border-foreground">Gate Result</th>
                    <th className="p-2">Reason Code & Details</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map((e, idx) => (
                    <tr key={idx} className="border-b border-foreground/30 hover:bg-muted/20">
                      <td className="p-2 border-r border-foreground text-muted-foreground text-[10px] whitespace-nowrap">
                        {new Date(e.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="p-2 border-r border-foreground font-bold text-[11px] whitespace-nowrap">
                        {e.actor}
                      </td>
                      <td className="p-2 border-r border-foreground font-black text-[11px]">
                        <span className={`px-1.5 py-0.5 ${
                          e.action === "ORDER_CREATED" ? "bg-emerald-100 text-emerald-900 border border-emerald-500" :
                          e.action === "CHECKOUT_BLOCKED" ? "bg-rose-100 text-rose-900 border border-rose-500" :
                          e.action === "QUOTE_ISSUED" ? "bg-indigo-100 text-indigo-900 border border-indigo-500" : "bg-muted"
                        }`}>
                          {e.action}
                        </span>
                      </td>
                      <td className="p-2 border-r border-foreground font-mono text-[10px] max-w-[150px] truncate" title={`${e.order_id || e.quote_id || ""}`}>
                        {e.order_id || e.quote_id || "—"}
                      </td>
                      <td className="p-2 border-r border-foreground font-black text-[10px] text-center">
                        {e.policy_version || "v1"}
                      </td>
                      <td className="p-2 border-r border-foreground font-bold whitespace-nowrap">
                        {e.amount_after ? `₹${e.amount_after}` : (e.amount_before ? `₹${e.amount_before}` : "—")}
                      </td>
                      <td className="p-2 border-r border-foreground">
                        <span className={`px-1.5 py-0.5 text-[9px] font-black uppercase ${
                          e.policy_result === "ALLOWED" ? "bg-emerald-500 text-white" : "bg-rose-500 text-white"
                        }`}>
                          {e.policy_result}
                        </span>
                      </td>
                      <td className="p-2 text-[11px] text-muted-foreground max-w-xs truncate" title={e.details || e.reason_code}>
                        <strong>{e.reason_code}:</strong> {e.details || "Normal autonomous execution"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: "WHY THIS DECISION?" TRACE ================= */}
      {selectedTrace && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-background border-4 border-foreground max-w-2xl w-full p-6 space-y-5 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] max-h-[90vh] overflow-y-auto">
            <div className="border-b-2 border-foreground pb-3 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black uppercase tracking-tight">"Why This Decision?" Trace</h3>
                <p className="text-[11px] text-muted-foreground">Deterministic policy evaluation audit without black-box opacity.</p>
              </div>
              <button
                onClick={() => setSelectedTrace(null)}
                className="border-2 border-foreground px-2.5 py-1 font-black text-xs hover:bg-foreground hover:text-background"
              >
                CLOSE
              </button>
            </div>

            {/* Trace content */}
            <div className="space-y-4 text-xs font-mono">
              <div className="border border-foreground p-3 bg-muted/20">
                <span className="text-[10px] font-black uppercase text-muted-foreground block mb-1">1. Buyer Intent Summary</span>
                <p className="font-bold">{selectedTrace.buyer_intent}</p>
              </div>

              <div className="border border-foreground p-3 bg-muted/20">
                <span className="text-[10px] font-black uppercase text-muted-foreground block mb-1">2. Matched Products & Policy Version</span>
                <p className="font-bold">Products: {selectedTrace.matched_products.join(", ")}</p>
                <p className="text-muted-foreground mt-1">Evaluated under policy snapshot: <strong>{selectedTrace.policy_version}</strong></p>
              </div>

              {selectedTrace.arithmetic && (
                <div className="border border-foreground p-3 bg-muted/20 space-y-2">
                  <span className="text-[10px] font-black uppercase text-muted-foreground block border-b border-border pb-1">3. Exact Arithmetic Breakdown</span>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div>Subtotal: <strong className="font-mono">₹{selectedTrace.arithmetic.subtotal}</strong></div>
                    <div>Combo Discount: <strong className="font-mono text-emerald-600">-₹{selectedTrace.arithmetic.discount}</strong></div>
                    <div>Final Captured: <strong className="font-mono text-indigo-600">₹{selectedTrace.arithmetic.final_total}</strong></div>
                    <div>Buyer Savings: <strong className="font-mono text-emerald-600">₹{selectedTrace.arithmetic.buyer_savings}</strong></div>
                  </div>
                </div>
              )}

              <div className="border border-foreground p-3 bg-muted/20 space-y-2">
                <span className="text-[10px] font-black uppercase text-muted-foreground block border-b border-border pb-1">4. Gate Evaluation Results</span>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(selectedTrace.gate_results).map(([gate, res]) => (
                    <div key={gate} className="flex items-center justify-between border-b border-dashed border-border py-1">
                      <span>{gate}:</span>
                      <span className={`px-1.5 py-0.5 text-[9px] font-black ${res === "PASS" ? "bg-emerald-500 text-white" : "bg-rose-500 text-white"}`}>
                        {res}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-2 border-foreground p-3 bg-foreground text-background">
                <span className="text-[10px] font-black uppercase block mb-1">5. Final Outcome & Business Reason</span>
                <p className="font-black text-sm">RESULT: {selectedTrace.outcome}</p>
                <p className="text-xs mt-1 opacity-90">{selectedTrace.business_reason}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: VIEW POLICY SNAPSHOT ================= */}
      {selectedSnapshot && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-background border-4 border-foreground max-w-xl w-full p-6 space-y-4 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
            <div className="border-b-2 border-foreground pb-2 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black uppercase">Policy Snapshot {selectedSnapshot.version}</h3>
                <span className="text-[10px] text-muted-foreground">Created {new Date(selectedSnapshot.created_at).toLocaleString()}</span>
              </div>
              <button
                onClick={() => setSelectedSnapshot(null)}
                className="border-2 border-foreground px-2 py-0.5 font-black text-xs hover:bg-foreground hover:text-background"
              >
                CLOSE
              </button>
            </div>

            <div className="space-y-3 font-mono text-xs">
              <div className="border p-2 bg-muted/20">
                <span className="text-[10px] font-black text-muted-foreground uppercase block">Change Summary</span>
                <p className="font-bold">{selectedSnapshot.change_summary}</p>
              </div>

              <div className="space-y-1.5 border p-2 bg-muted/10">
                <div className="flex justify-between">
                  <span>Autonomous Cap:</span>
                  <span className="font-black">₹{selectedSnapshot.policy.max_autonomous_checkout_paise / 100}</span>
                </div>
                <div className="flex justify-between">
                  <span>Quote Expiry TTL:</span>
                  <span className="font-black">{selectedSnapshot.policy.quote_expiry_seconds}s</span>
                </div>
                <div className="flex justify-between">
                  <span>Mandate Required:</span>
                  <span className="font-black">{selectedSnapshot.policy.mandate_required ? "YES" : "NO"}</span>
                </div>
                <div className="flex justify-between">
                  <span>Can Recommend Bundles:</span>
                  <span className="font-black">{selectedSnapshot.policy.agent_can_recommend_bundles ? "YES" : "NO"}</span>
                </div>
                <div className="flex justify-between">
                  <span>Can Negotiate:</span>
                  <span className="font-black">{selectedSnapshot.policy.agent_can_negotiate ? "YES" : "NO"}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
