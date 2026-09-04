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
  ExternalLink,
  Sliders,
  DollarSign,
  Edit3,
  X,
  ChevronDown,
  ChevronUp,
  FileText,
  Lock,
  Zap,
  ShoppingBag
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
  images?: string[];
}

type TabType = "overview" | "catalog" | "policy" | "activity";

export const MerchantControlCenter: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>("overview");
  const [config, setConfig] = useState<MerchantConfig | null>(null);
  const [activeVersion, setActiveVersion] = useState<string>("v1");
  const [policyVersions, setPolicyVersions] = useState<(PolicyVersionSnapshot & { quote_count: number })[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [selectedBundleIndex, setSelectedBundleIndex] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastSyncedTime, setLastSyncedTime] = useState<string>("Just now");

  // Stats
  const [todayRevenue, setTodayRevenue] = useState(0);
  const [todayOrders, setTodayOrders] = useState(0);
  const [blockedActions, setBlockedActions] = useState(0);
  const [stockIncidents, setStockIncidents] = useState(0);
  const [totalBuyerSavings, setTotalBuyerSavings] = useState(0);
  const [ledgerEvents, setLedgerEvents] = useState<AuditEvent[]>([]);
  const [journeys, setJourneys] = useState<AgentJourney[]>([]);

  // Modals & Drawers
  const [selectedTrace, setSelectedTrace] = useState<AgentJourney["trace"] | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState<PolicyVersionSnapshot | null>(null);
  const [editingProduct, setEditingProduct] = useState<ProductRow | null>(null);
  const [showPublishDiff, setShowPublishDiff] = useState(false);
  const [customSummaryNote, setCustomSummaryNote] = useState("");
  const [showHowItWorks, setShowHowItWorks] = useState(false);
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
            colors: p.colors || [],
            images: p.images || []
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

      setLastSyncedTime(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
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

  const handleSaveProductDrawer = (updatedProduct: ProductRow) => {
    setProducts(products.map(p => p.id === updatedProduct.id ? updatedProduct : p));
    if (config) {
      const currentOverride = config.product_overrides[updatedProduct.id] || { negotiable: true, max_discount_percent: 10 };
      setConfig({
        ...config,
        product_overrides: {
          ...config.product_overrides,
          [updatedProduct.id]: {
            ...currentOverride,
            negotiable: updatedProduct.negotiable,
            max_discount_percent: updatedProduct.max_discount_percent
          }
        }
      });
    }
    setEditingProduct(null);
  };

  const handleUpdateBundle = (index: number, field: keyof BundleRule, value: any) => {
    if (!config || !config.bundle_rules[index]) return;
    const updated = [...config.bundle_rules];
    updated[index] = {
      ...updated[index],
      [field]: value
    };
    setConfig({
      ...config,
      bundle_rules: updated
    });
  };

  const handleExecutePublish = async () => {
    if (!config) return;
    setSaving(true);
    setMessage(null);
    setErrorMsg(null);

    // Guard: Prevent same-product bundle pairing
    for (const b of config.bundle_rules) {
      const ids = b.product_ids || [b.product_a_id, b.product_b_id].filter(Boolean) as string[];
      const unique = new Set(ids);
      if (unique.size !== ids.length) {
        setErrorMsg(`Invalid Bundle Pairing in "${b.name}": A bundle cannot contain duplicate items.`);
        setSaving(false);
        setShowPublishDiff(false);
        return;
      }
    }

    try {
      const res = await fetch("/api/merchant/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config,
          products,
          change_summary: customSummaryNote.trim() || undefined
        })
      });

      const data = await res.json();
      if (data.status === "success") {
        setMessage(`Policy published successfully! Active version: ${data.active_version || "updated"}`);
        setTimeout(() => setMessage(null), 4000);
        setShowPublishDiff(false);
        setCustomSummaryNote("");
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
      <div className="flex flex-col items-center justify-center p-24 text-neutral-800 font-sans text-sm space-y-4">
        <RefreshCw className="w-8 h-8 animate-spin text-neutral-900" />
        <span className="font-semibold text-neutral-600">Loading merchant workspace...</span>
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
    <div className="space-y-6 font-sans text-neutral-900 max-w-7xl mx-auto pb-16 px-4 sm:px-6">
      
      {/* ================= 1. COMPACT APP HEADER ================= */}
      <header className="bg-white/80 backdrop-blur-md border border-black/10 rounded-2xl p-4 sm:p-5 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3 sm:space-x-4">
          <div className="flex items-center space-x-2 bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-full text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Store is live</span>
          </div>

          <div className="flex items-center space-x-2 bg-violet-50 text-violet-700 border border-violet-200 px-2.5 py-1 rounded-full text-xs font-semibold">
            <span>Policy {activeVersion}</span>
          </div>

          <span className="text-xs text-neutral-500 hidden sm:inline-flex items-center space-x-1">
            <Clock className="w-3.5 h-3.5" />
            <span>Last synced {lastSyncedTime}</span>
          </span>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center space-x-3">
          {message && (
            <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-lg font-medium animate-fade-in flex items-center space-x-1.5">
              <Check className="w-3.5 h-3.5" />
              <span>{message}</span>
            </span>
          )}
          {errorMsg && (
            <span className="text-xs bg-rose-50 text-rose-700 border border-rose-200 px-3 py-1.5 rounded-lg font-medium flex items-center space-x-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{errorMsg}</span>
            </span>
          )}

          <button
            onClick={() => loadConfigAndProducts()}
            title="Refresh store state"
            className="p-2 border border-black/10 rounded-xl text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          <button
            onClick={() => setShowPublishDiff(true)}
            disabled={saving}
            className="flex items-center space-x-2 bg-neutral-900 text-white px-4 py-2 rounded-xl font-semibold text-xs hover:bg-neutral-800 transition-all shadow-sm active:scale-[0.98] disabled:opacity-50"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Publish changes</span>
          </button>
        </div>
      </header>

      {/* ================= 2. FOUR SECTION TABS ================= */}
      <nav className="flex space-x-1 sm:space-x-2 border-b border-black/10 pb-2">
        <button
          onClick={() => setActiveTab("overview")}
          className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all flex items-center space-x-2 ${
            activeTab === "overview"
              ? "bg-neutral-900 text-white shadow-sm"
              : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100"
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          <span>Overview</span>
        </button>

        <button
          onClick={() => setActiveTab("catalog")}
          className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all flex items-center space-x-2 ${
            activeTab === "catalog"
              ? "bg-neutral-900 text-white shadow-sm"
              : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100"
          }`}
        >
          <PackageCheck className="w-4 h-4" />
          <span>Catalog & Bundles</span>
          <span className="ml-1 px-1.5 py-0.2 bg-neutral-200 text-neutral-800 rounded-full text-[10px]">
            {activeProductsCount}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("policy")}
          className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all flex items-center space-x-2 ${
            activeTab === "policy"
              ? "bg-neutral-900 text-white shadow-sm"
              : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100"
          }`}
        >
          <Shield className="w-4 h-4" />
          <span>Agent Policy</span>
          <span className="ml-1 px-1.5 py-0.2 bg-violet-100 text-violet-800 rounded-full text-[10px]">
            {policyVersions.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("activity")}
          className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all flex items-center space-x-2 ${
            activeTab === "activity"
              ? "bg-neutral-900 text-white shadow-sm"
              : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100"
          }`}
        >
          <Activity className="w-4 h-4" />
          <span>Activity & Ledger</span>
          <span className="ml-1 px-1.5 py-0.2 bg-emerald-100 text-emerald-800 rounded-full text-[10px]">
            {journeys.length}
          </span>
        </button>
      </nav>

      {/* ================= TAB 1: OVERVIEW ================= */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          
          {/* 4 Primary Key Performance Indicators */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white/80 border border-black/10 p-5 rounded-2xl shadow-sm space-y-1">
              <span className="text-xs font-medium text-neutral-500">Revenue captured</span>
              <p className="text-2xl font-bold tracking-tight text-neutral-900">₹{todayRevenue.toLocaleString()}</p>
              <p className="text-xs text-neutral-500 pt-1 flex items-center space-x-1">
                <span>{todayOrders} settled order{todayOrders === 1 ? "" : "s"}</span>
              </p>
            </div>

            <div className="bg-white/80 border border-black/10 p-5 rounded-2xl shadow-sm space-y-1">
              <span className="text-xs font-medium text-neutral-500">Orders completed</span>
              <p className="text-2xl font-bold tracking-tight text-neutral-900">{todayOrders}</p>
              <p className="text-xs text-emerald-600 pt-1 font-medium">
                100% autonomous zero-click execution
              </p>
            </div>

            <div className="bg-white/80 border border-black/10 p-5 rounded-2xl shadow-sm space-y-1">
              <span className="text-xs font-medium text-neutral-500">Average order value</span>
              <p className="text-2xl font-bold tracking-tight text-neutral-900">
                ₹{todayOrders > 0 ? Math.round(todayRevenue / todayOrders) : 0}
              </p>
              <p className="text-xs text-neutral-500 pt-1">
                Based on active checkout transactions
              </p>
            </div>

            <div className="bg-white/80 border border-black/10 p-5 rounded-2xl shadow-sm space-y-1">
              <span className="text-xs font-medium text-neutral-500">Revenue protected</span>
              <p className="text-2xl font-bold tracking-tight text-neutral-900">{blockedActions}</p>
              <p className="text-xs text-emerald-600 pt-1 font-medium">
                Blocked out-of-policy bids & cap breaches
              </p>
            </div>
          </div>

          {/* Secondary Growth Signals Section */}
          <div className="bg-white/80 border border-black/10 p-6 rounded-2xl shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-neutral-900 flex items-center space-x-2">
              <TrendingUp className="w-4 h-4 text-violet-600" />
              <span>Growth signals</span>
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-neutral-50/70 border border-black/5 p-4 rounded-xl space-y-1">
                <span className="text-xs text-neutral-500 font-medium">Buyer savings delivered</span>
                <p className="text-xl font-bold text-emerald-700">₹{totalBuyerSavings}</p>
                <p className="text-xs text-neutral-500">Delivered via approved discount bounds and bundle deals.</p>
              </div>

              <div className="bg-neutral-50/70 border border-black/5 p-4 rounded-xl space-y-1">
                <span className="text-xs text-neutral-500 font-medium">Active bundle pairing</span>
                <p className="text-xl font-bold text-violet-700">{bundle?.name || "Complete Outfit"} ({bundle?.discount_percent || 15}% combo discount)</p>
                <p className="text-xs text-neutral-500">Cross-sells matching bottom with shirt to expand average basket size.</p>
              </div>
            </div>
          </div>

          {/* Collapsible How It Works Architecture Section */}
          <div className="bg-white/60 border border-black/10 rounded-2xl overflow-hidden shadow-sm">
            <button
              onClick={() => setShowHowItWorks(!showHowItWorks)}
              className="w-full p-4 flex items-center justify-between text-left hover:bg-neutral-50/50 transition-colors"
            >
              <div className="flex items-center space-x-2">
                <Info className="w-4 h-4 text-neutral-500" />
                <span className="text-xs font-semibold text-neutral-800">How the autonomous commerce loop works</span>
              </div>
              {showHowItWorks ? <ChevronUp className="w-4 h-4 text-neutral-500" /> : <ChevronDown className="w-4 h-4 text-neutral-500" />}
            </button>

            {showHowItWorks && (
              <div className="p-5 pt-0 border-t border-black/5 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-neutral-600">
                <div className="p-3 bg-neutral-50 rounded-xl space-y-1">
                  <span className="font-semibold text-neutral-900 block">1. Catalog Discovery</span>
                  <p>AI agents inspect products, live stock, negotiability limits, and bundle pairings via <code className="text-neutral-800 font-mono text-[11px]">/api/agent/catalog</code>.</p>
                </div>
                <div className="p-3 bg-neutral-50 rounded-xl space-y-1">
                  <span className="font-semibold text-neutral-900 block">2. Policy-Bound Quotes</span>
                  <p>Dynamic bids are checked against merchant discount caps and sealed with HMAC signatures embedding the active policy version.</p>
                </div>
                <div className="p-3 bg-neutral-50 rounded-xl space-y-1">
                  <span className="font-semibold text-neutral-900 block">3. Autonomous Rails</span>
                  <p>Valid orders settle instantly without human approval queues via atomic inventory decrement and Razorpay idempotency rails.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= TAB 2: CATALOG & BUNDLES ================= */}
      {activeTab === "catalog" && (
        <div className="space-y-6">
          
          {/* Authoritative Product Table Card */}
          <div className="bg-white/80 border border-black/10 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-black/5">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900">Authoritative Product Catalog</h3>
                <p className="text-xs text-neutral-500">Live products queried directly from the Postgres database. Click edit to adjust pricing or bounds.</p>
              </div>
              <span className="text-xs bg-neutral-100 border border-black/5 px-2.5 py-1 rounded-full text-neutral-700 font-medium">
                {activeProductsCount} active product{activeProductsCount === 1 ? "" : "s"}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-neutral-700 border-collapse">
                <thead>
                  <tr className="border-b border-black/10 text-neutral-500 font-medium">
                    <th className="py-3 px-3">Product</th>
                    <th className="py-3 px-3">Category</th>
                    <th className="py-3 px-3">Price</th>
                    <th className="py-3 px-3">Stock</th>
                    <th className="py-3 px-3">Negotiation</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5">
                  {products.map((p) => (
                    <tr key={p.id} className="hover:bg-neutral-50/50 transition-colors">
                      <td className="py-3 px-3 font-semibold text-neutral-900 flex items-center space-x-3">
                        <div className="w-10 h-10 rounded-lg overflow-hidden bg-neutral-100 border border-black/10 shrink-0 flex items-center justify-center">
                          <img
                            src={p.images?.[0] || "/placeholder.svg"}
                            alt={p.name}
                            onError={(e) => { e.currentTarget.src = "/placeholder.svg"; }}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div>
                          <span className="block font-semibold">{p.name}</span>
                          <span className="text-[11px] text-neutral-400 font-mono">{p.id.substring(0, 8)}...</span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-neutral-500">{p.category || "Apparel"}</td>
                      <td className="py-3 px-3 font-medium text-neutral-900">₹{Math.round(p.price_paise / 100)}</td>
                      <td className="py-3 px-3">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                          p.stock > 5 ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-amber-50 text-amber-700 border border-amber-200"
                        }`}>
                          {p.stock} units
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        {p.negotiable ? (
                          <span className="text-neutral-800 font-medium">Allowed (Max {p.max_discount_percent}%)</span>
                        ) : (
                          <span className="text-neutral-400">Fixed price</span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        {p.active ? (
                          <span className="text-emerald-700 font-medium text-[11px]">Active</span>
                        ) : (
                          <span className="text-neutral-400 font-medium text-[11px]">Inactive</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          onClick={() => setEditingProduct(p)}
                          className="px-2.5 py-1 text-xs border border-black/10 rounded-lg hover:bg-neutral-900 hover:text-white transition-colors font-medium"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Outfit Bundle Pairing Card */}
          <div className="bg-white/80 border border-black/10 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-black/5">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900">Outfit Bundle Pairing & Multi-Buy Rules</h3>
                <p className="text-xs text-neutral-500">Configure cross-sell combinations recommended automatically by the conversational agent.</p>
              </div>
              <span className="text-xs bg-violet-50 text-violet-700 border border-violet-200 px-2.5 py-1 rounded-full font-semibold">
                {config?.bundle_rules?.length || 0} configured bundle{config?.bundle_rules?.length === 1 ? "" : "s"}
              </span>
            </div>

            {/* Bundle Selector Tabs */}
            {config && config.bundle_rules && config.bundle_rules.length > 0 && (
              <div className="flex flex-wrap gap-2 pb-2">
                {config.bundle_rules.map((b, idx) => (
                  <button
                    key={b.id || idx}
                    onClick={() => setSelectedBundleIndex(idx)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-xl border transition-all flex items-center space-x-2 ${
                      selectedBundleIndex === idx
                        ? "bg-neutral-900 text-white border-neutral-900 shadow-sm"
                        : "bg-neutral-50 text-neutral-600 border-black/10 hover:bg-neutral-100"
                    }`}
                  >
                    <span>{b.name} ({b.discount_percent}% off)</span>
                    <span className={`w-2 h-2 rounded-full ${b.active ? "bg-emerald-500" : "bg-neutral-400"}`} />
                  </button>
                ))}
              </div>
            )}

            {config && config.bundle_rules && config.bundle_rules[selectedBundleIndex] ? (
              (() => {
                const currentBundle = config.bundle_rules[selectedBundleIndex];
                const productIds = currentBundle.product_ids || [currentBundle.product_a_id, currentBundle.product_b_id].filter(Boolean) as string[];
                const bundleProds = productIds.map(id => products.find(p => p.id === id)).filter(Boolean) as ProductRow[];

                return (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                    {/* Form Controls */}
                    <div className="space-y-4 text-xs">
                      <div>
                        <label className="block text-neutral-600 font-medium mb-1">Bundle name</label>
                        <input
                          type="text"
                          value={currentBundle.name}
                          onChange={(e) => handleUpdateBundle(selectedBundleIndex, "name", e.target.value)}
                          className="w-full bg-neutral-50 border border-black/10 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-neutral-900"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="block text-neutral-600 font-medium">Included Products in Bundle ({bundleProds.length} items)</label>
                        <div className="p-3 bg-neutral-50 border border-black/10 rounded-xl space-y-2">
                          {bundleProds.map((prod, pIdx) => (
                            <div key={prod.id || pIdx} className="flex items-center justify-between text-xs py-1 border-b border-black/5 last:border-0">
                              <div className="flex items-center space-x-2">
                                <div className="w-6 h-6 rounded bg-neutral-200 overflow-hidden shrink-0">
                                  <img
                                    src={prod.images?.[0] || "/placeholder.svg"}
                                    alt={prod.name}
                                    onError={(e) => { e.currentTarget.src = "/placeholder.svg"; }}
                                    className="w-full h-full object-cover"
                                  />
                                </div>
                                <span className="font-medium text-neutral-900">{prod.name}</span>
                              </div>
                              <span className="font-semibold text-neutral-700">₹{Math.round(prod.price_paise / 100)}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="block text-neutral-600 font-medium mb-1">Recommendation reason</label>
                        <input
                          type="text"
                          value={currentBundle.recommendation_reason || ""}
                          onChange={(e) => handleUpdateBundle(selectedBundleIndex, "recommendation_reason", e.target.value)}
                          placeholder="Why should the agent recommend this pairing?"
                          className="w-full bg-neutral-50 border border-black/10 rounded-xl px-3 py-2 text-xs focus:outline-none"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3 items-center">
                        <div>
                          <label className="block text-neutral-600 font-medium mb-1">Combo discount (%)</label>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={currentBundle.discount_percent}
                            onChange={(e) => handleUpdateBundle(selectedBundleIndex, "discount_percent", parseInt(e.target.value || "0"))}
                            className="w-full bg-neutral-50 border border-black/10 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-neutral-600 font-medium mb-1">Status</label>
                          <button
                            onClick={() => handleUpdateBundle(selectedBundleIndex, "active", !currentBundle.active)}
                            className={`w-full py-2 rounded-xl text-xs font-semibold border transition-all ${
                              currentBundle.active
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-neutral-100 text-neutral-500 border-black/5"
                            }`}
                          >
                            {currentBundle.active ? "Active in Discovery" : "Inactive / Muted"}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Dynamic Economics Live Computation Card */}
                    {(() => {
                      const individualTotal = bundleProds.reduce((sum, p) => sum + Math.round(p.price_paise / 100), 0);
                      const discountAmt = Math.round((individualTotal * currentBundle.discount_percent) / 100);
                      const bundleTotal = individualTotal - discountAmt;
                      const buyerSavings = discountAmt;
                      const baseItemPrice = bundleProds[0] ? Math.round(bundleProds[0].price_paise / 100) : 0;
                      const incrementalRevenue = bundleTotal - baseItemPrice;

                      return (
                        <div className="bg-neutral-50/80 border border-black/10 rounded-2xl p-5 space-y-4">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-neutral-900">Live economics preview ({currentBundle.name})</span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              currentBundle.active ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-neutral-200 text-neutral-600"
                            }`}>
                              {currentBundle.active ? "Active in Discovery" : "Inactive / Muted"}
                            </span>
                          </div>
                          
                          <div className="space-y-2 text-xs">
                            <div className="flex justify-between text-neutral-600">
                              <span>Individual items ({bundleProds.map(p => p.name.split(" ")[0]).join(" + ") || "Items"}):</span>
                              <span className="font-medium">₹{individualTotal}</span>
                            </div>
                            <div className="flex justify-between border-b border-black/10 pb-2 text-neutral-900">
                              <span className="font-medium">Combo total ({currentBundle.discount_percent}% bundle discount):</span>
                              <span className="font-bold text-sm">₹{bundleTotal}</span>
                            </div>
                            <div className="flex justify-between text-emerald-700 font-medium">
                              <span>Buyer savings:</span>
                              <span>₹{buyerSavings}</span>
                            </div>
                            <div className="flex justify-between text-violet-700 font-bold">
                              <span>Merchant captured revenue:</span>
                              <span>₹{bundleTotal}</span>
                            </div>
                          </div>

                          <div className="bg-white p-3 rounded-xl border border-black/5 text-[11px] text-neutral-600 leading-relaxed">
                            <strong>Revenue growth story:</strong> Selling this {bundleProds.length}-item bundle captures <span className="text-violet-700 font-semibold">+₹{incrementalRevenue}</span> incremental revenue versus selling {bundleProds[0]?.name || "the main item"} alone.
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })()
            ) : (
              <p className="text-xs text-neutral-500">No bundle rules configured.</p>
            )}
          </div>
        </div>
      )}

      {/* ================= TAB 3: AGENT POLICY ================= */}
      {activeTab === "policy" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* 1. What the agent can do */}
            <div className="bg-white/80 border border-black/10 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
              <div className="pb-2 border-b border-black/5">
                <h3 className="text-sm font-semibold text-neutral-900">What the agent can do</h3>
                <p className="text-xs text-neutral-500">Enable or restrict autonomous capabilities executed by the AI clerk.</p>
              </div>

              {config && (
                <div className="space-y-3 text-xs">
                  <label className="flex items-center justify-between p-3 rounded-xl border border-black/5 bg-neutral-50/50 hover:bg-neutral-50 cursor-pointer">
                    <div>
                      <span className="font-medium text-neutral-900 block">Recommend bundles</span>
                      <span className="text-[11px] text-neutral-500">Proactively cross-sell matching pants or add-ons</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={config.policy.agent_can_recommend_bundles}
                      onChange={(e) => handleUpdatePolicy("agent_can_recommend_bundles", e.target.checked)}
                      className="w-4 h-4 accent-neutral-900 rounded"
                    />
                  </label>

                  <label className="flex items-center justify-between p-3 rounded-xl border border-black/5 bg-neutral-50/50 hover:bg-neutral-50 cursor-pointer">
                    <div>
                      <span className="font-medium text-neutral-900 block">Negotiate prices</span>
                      <span className="text-[11px] text-neutral-500">Accept programmatic bids bounded by discount caps</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={config.policy.agent_can_negotiate}
                      onChange={(e) => handleUpdatePolicy("agent_can_negotiate", e.target.checked)}
                      className="w-4 h-4 accent-neutral-900 rounded"
                    />
                  </label>

                  <label className="flex items-center justify-between p-3 rounded-xl border border-black/5 bg-neutral-50/50 hover:bg-neutral-50 cursor-pointer">
                    <div>
                      <span className="font-medium text-neutral-900 block">Autonomous checkout</span>
                      <span className="text-[11px] text-neutral-500">Create Razorpay orders without human merchant approval</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={config.policy.agent_can_checkout}
                      onChange={(e) => handleUpdatePolicy("agent_can_checkout", e.target.checked)}
                      className="w-4 h-4 accent-neutral-900 rounded"
                    />
                  </label>
                </div>
              )}
            </div>

            {/* 2. Commerce boundaries */}
            <div className="bg-white/80 border border-black/10 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
              <div className="pb-2 border-b border-black/5">
                <h3 className="text-sm font-semibold text-neutral-900">Commerce boundaries</h3>
                <p className="text-xs text-neutral-500">Hard deterministic safety gates enforced server-side before order creation.</p>
              </div>

              {config && (
                <div className="space-y-4 text-xs">
                  <div>
                    <label className="block text-neutral-600 font-medium mb-1">
                      Autonomous spending cap (₹)
                    </label>
                    <input
                      type="number"
                      value={Math.round(config.policy.max_autonomous_checkout_paise / 100)}
                      onChange={(e) => handleUpdatePolicy("max_autonomous_checkout_paise", parseInt(e.target.value || "0") * 100)}
                      className="w-full bg-neutral-50 border border-black/10 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-neutral-900"
                    />
                    <p className="text-[11px] text-neutral-500 mt-1">Orders exceeding this limit are rejected immediately.</p>
                  </div>

                  <div>
                    <label className="block text-neutral-600 font-medium mb-1">
                      Quote expiration window (seconds)
                    </label>
                    <input
                      type="number"
                      value={config.policy.quote_expiry_seconds}
                      onChange={(e) => handleUpdatePolicy("quote_expiry_seconds", parseInt(e.target.value || "600"))}
                      className="w-full bg-neutral-50 border border-black/10 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-neutral-900"
                    />
                    <p className="text-[11px] text-neutral-500 mt-1">Standard: 600s (10 minutes). Quote tokens expire automatically after this window.</p>
                  </div>

                  <label className="flex items-center justify-between p-3 rounded-xl border border-black/5 bg-neutral-50/50 hover:bg-neutral-50 cursor-pointer">
                    <div>
                      <span className="font-medium text-neutral-900 block">Require UPI Mandate consent</span>
                      <span className="text-[11px] text-neutral-500">Enforces buyer pre-authorization signature before checkout</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={config.policy.mandate_required}
                      onChange={(e) => handleUpdatePolicy("mandate_required", e.target.checked)}
                      className="w-4 h-4 accent-neutral-900 rounded"
                    />
                  </label>
                </div>
              )}
            </div>
          </div>

          {/* 3. Policy History (Immutable Versions) */}
          <div className="bg-white/80 border border-black/10 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-black/5">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900">Policy history & versions</h3>
                <p className="text-xs text-neutral-500">Historical snapshots are immutable. Quotes remain valid under their embedded version until expiration.</p>
              </div>
              <span className="text-xs bg-violet-50 text-violet-700 border border-violet-200 px-2.5 py-1 rounded-full font-semibold">
                {policyVersions.length} recorded version{policyVersions.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-neutral-700 border-collapse">
                <thead>
                  <tr className="border-b border-black/10 text-neutral-500 font-medium">
                    <th className="py-2.5 px-3">Version</th>
                    <th className="py-2.5 px-3">Created date</th>
                    <th className="py-2.5 px-3">Change summary</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-center">Quotes issued</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5">
                  {policyVersions.map((v) => (
                    <tr key={v.version} className={`hover:bg-neutral-50/50 transition-colors ${v.status === "active" ? "bg-violet-50/30 font-medium" : ""}`}>
                      <td className="py-3 px-3 font-semibold text-neutral-900">{v.version}</td>
                      <td className="py-3 px-3 text-neutral-500">
                        {new Date(v.created_at).toLocaleDateString()} {new Date(v.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="py-3 px-3 max-w-xs truncate text-neutral-600" title={v.change_summary}>
                        {v.change_summary}
                      </td>
                      <td className="py-3 px-3">
                        {v.status === "active" ? (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Active
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-neutral-100 text-neutral-500">
                            Superseded
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center font-semibold text-neutral-900">{v.quote_count || 0}</td>
                      <td className="py-3 px-3 text-right space-x-2">
                        <button
                          onClick={() => setSelectedSnapshot(v)}
                          className="px-2.5 py-1 text-xs border border-black/10 rounded-lg hover:bg-neutral-100 transition-colors font-medium"
                        >
                          View snapshot
                        </button>
                        {v.status !== "active" && (
                          <button
                            onClick={() => handleRollback(v.version)}
                            className="px-2.5 py-1 text-xs border border-amber-200 bg-amber-50 text-amber-800 rounded-lg hover:bg-amber-100 transition-colors font-medium"
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
      )}

      {/* ================= TAB 4: ACTIVITY & LEDGER ================= */}
      {activeTab === "activity" && (
        <div className="space-y-6">
          
          {/* Grouped Agent Activity Journeys (Top) */}
          <div className="bg-white/80 border border-black/10 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-black/5">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900">Grouped agent activity journeys</h3>
                <p className="text-xs text-neutral-500">End-to-end transaction sessions connecting discovery, recommendation, negotiation, and settlement.</p>
              </div>
              <span className="text-xs bg-neutral-100 border border-black/5 px-2.5 py-1 rounded-full text-neutral-700 font-medium">
                {journeys.length} session{journeys.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {journeys.slice(0, 6).map((j) => (
                <div key={j.journey_id} className="bg-neutral-50/80 border border-black/10 rounded-2xl p-4 space-y-3 flex flex-col justify-between hover:border-black/20 transition-all">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono text-neutral-500 truncate max-w-[180px]">
                        Session: {j.journey_id}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                        j.status === "COMPLETED" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                        j.status === "BLOCKED" ? "bg-rose-50 text-rose-700 border border-rose-200" : "bg-neutral-100 text-neutral-600"
                      }`}>
                        {j.status === "COMPLETED" ? "Completed" : j.status === "BLOCKED" ? "Blocked" : j.status}
                      </span>
                    </div>

                    <p className="text-xs font-semibold text-neutral-900 leading-snug">{j.intent_summary}</p>

                    <div className="flex items-center space-x-2 text-xs text-neutral-500">
                      <span>Policy: <strong className="text-neutral-700">{j.policy_version}</strong></span>
                      <span>•</span>
                      <span>Amount: <strong className="text-neutral-900">₹{j.final_amount || 649}</strong></span>
                      <span>•</span>
                      <span>{j.events.length} event{j.events.length === 1 ? "" : "s"}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => setSelectedTrace(j.trace)}
                    className="w-full py-2 px-3 border border-black/10 bg-white rounded-xl text-xs font-semibold text-neutral-800 hover:bg-neutral-900 hover:text-white transition-all flex items-center justify-center space-x-1.5 shadow-sm"
                  >
                    <span>View decision trace</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Searchable Durable Trust Ledger (Bottom) */}
          <div className="bg-white/80 border border-black/10 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-black/5">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900">Durable Trust Ledger Audit Events</h3>
                <p className="text-xs text-neutral-500">Cryptographic audit log persisted to disk for compliance and traceability.</p>
              </div>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-neutral-400" />
                <input
                  type="text"
                  placeholder="Filter by order, action, reason..."
                  value={ledgerFilter}
                  onChange={(e) => setLedgerFilter(e.target.value)}
                  className="bg-neutral-50 border border-black/10 rounded-xl pl-9 pr-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-neutral-900 w-64 font-medium"
                />
              </div>
            </div>

            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-left text-xs text-neutral-700 border-collapse">
                <thead className="sticky top-0 bg-neutral-100 border-b border-black/10 z-10 text-neutral-500 font-medium">
                  <tr>
                    <th className="py-2.5 px-3">Time</th>
                    <th className="py-2.5 px-3">Actor</th>
                    <th className="py-2.5 px-3">Action</th>
                    <th className="py-2.5 px-3">Ref ID</th>
                    <th className="py-2.5 px-3">Policy</th>
                    <th className="py-2.5 px-3">Amount</th>
                    <th className="py-2.5 px-3">Result</th>
                    <th className="py-2.5 px-3">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5 font-sans">
                  {filteredEvents.map((e, idx) => (
                    <tr key={idx} className="hover:bg-neutral-50/50 transition-colors">
                      <td className="py-2.5 px-3 text-neutral-400 text-[11px] whitespace-nowrap">
                        {new Date(e.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-neutral-900 whitespace-nowrap">
                        {e.actor}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px]">
                        <span className={`px-2 py-0.5 rounded-full ${
                          e.action === "ORDER_CREATED" ? "bg-emerald-50 text-emerald-700 font-medium" :
                          e.action === "CHECKOUT_BLOCKED" ? "bg-rose-50 text-rose-700 font-medium" :
                          e.action === "QUOTE_ISSUED" ? "bg-violet-50 text-violet-700 font-medium" : "bg-neutral-100 text-neutral-600"
                        }`}>
                          {e.action}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-neutral-500 max-w-[140px] truncate" title={`${e.order_id || e.quote_id || ""}`}>
                        {e.order_id || e.quote_id || "—"}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-neutral-700">{e.policy_version || "v1"}</td>
                      <td className="py-2.5 px-3 font-medium text-neutral-900 whitespace-nowrap">
                        {e.amount_after ? `₹${e.amount_after}` : (e.amount_before ? `₹${e.amount_before}` : "—")}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          e.policy_result === "ALLOWED" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                        }`}>
                          {e.policy_result}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-neutral-600 max-w-xs truncate" title={e.details || e.reason_code}>
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

      {/* ================= MODAL: EDIT PRODUCT DRAWER ================= */}
      {editingProduct && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-black/10 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-xl max-h-[90vh] overflow-y-auto animate-scale-up">
            <div className="flex items-center justify-between pb-3 border-b border-black/10">
              <div>
                <h3 className="text-base font-semibold text-neutral-900">Edit Product</h3>
                <p className="text-xs text-neutral-500">Update authoritative database pricing and negotiation boundaries.</p>
              </div>
              <button
                onClick={() => setEditingProduct(null)}
                className="p-1 rounded-lg hover:bg-neutral-100 text-neutral-500 hover:text-neutral-900"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-neutral-600 font-medium mb-1">Product title</label>
                <input
                  type="text"
                  value={editingProduct.name}
                  onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })}
                  className="w-full bg-neutral-50 border border-black/10 rounded-xl px-3 py-2 text-xs font-medium focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-neutral-600 font-medium mb-1">Base Price (₹)</label>
                  <input
                    type="number"
                    value={Math.round(editingProduct.price_paise / 100)}
                    onChange={(e) => setEditingProduct({ ...editingProduct, price_paise: parseInt(e.target.value || "0") * 100 })}
                    className="w-full bg-neutral-50 border border-black/10 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-neutral-600 font-medium mb-1">Stock units</label>
                  <input
                    type="number"
                    value={editingProduct.stock}
                    onChange={(e) => setEditingProduct({ ...editingProduct, stock: parseInt(e.target.value || "0") })}
                    className="w-full bg-neutral-50 border border-black/10 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none"
                  />
                </div>
              </div>

              <div className="space-y-3 pt-2 border-t border-black/5">
                <label className="flex items-center justify-between p-3 rounded-xl border border-black/5 bg-neutral-50/50 hover:bg-neutral-50 cursor-pointer">
                  <div>
                    <span className="font-medium text-neutral-900 block">Allow Price Negotiation</span>
                    <span className="text-[11px] text-neutral-500">Enables AI buyer agent to negotiate below base price</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={editingProduct.negotiable}
                    onChange={(e) => setEditingProduct({ ...editingProduct, negotiable: e.target.checked })}
                    className="w-4 h-4 accent-neutral-900 rounded"
                  />
                </label>

                {editingProduct.negotiable && (
                  <div>
                    <label className="block text-neutral-600 font-medium mb-1">
                      Maximum Allowed Discount (%)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={editingProduct.max_discount_percent}
                      onChange={(e) => setEditingProduct({ ...editingProduct, max_discount_percent: parseInt(e.target.value || "0") })}
                      className="w-full bg-neutral-50 border border-black/10 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none"
                    />
                    <p className="text-[11px] text-neutral-500 mt-1">
                      Minimum accepted price floor: ₹{Math.round((editingProduct.price_paise * (1 - editingProduct.max_discount_percent / 100)) / 100)}
                    </p>
                  </div>
                )}

                <label className="flex items-center justify-between p-3 rounded-xl border border-black/5 bg-neutral-50/50 hover:bg-neutral-50 cursor-pointer">
                  <div>
                    <span className="font-medium text-neutral-900 block">Product active in catalog</span>
                    <span className="text-[11px] text-neutral-500">Exposes product to agent discovery feed</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={editingProduct.active}
                    onChange={(e) => setEditingProduct({ ...editingProduct, active: e.target.checked })}
                    className="w-4 h-4 accent-neutral-900 rounded"
                  />
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-3 border-t border-black/10">
              <button
                onClick={() => setEditingProduct(null)}
                className="px-4 py-2 border border-black/10 rounded-xl text-xs font-medium text-neutral-600 hover:bg-neutral-100"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSaveProductDrawer(editingProduct)}
                className="px-4 py-2 bg-neutral-900 text-white rounded-xl text-xs font-semibold hover:bg-neutral-800 shadow-sm"
              >
                Apply Overrides
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: PRE-PUBLISH POLICY DIFF ================= */}
      {showPublishDiff && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-black/10 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-xl animate-scale-up">
            <div className="flex items-center justify-between pb-3 border-b border-black/10">
              <div>
                <h3 className="text-base font-semibold text-neutral-900">Publish Policy Changes</h3>
                <p className="text-xs text-neutral-500">Review pending updates before creating an immutable policy version snapshot.</p>
              </div>
              <button
                onClick={() => setShowPublishDiff(false)}
                className="p-1 rounded-lg hover:bg-neutral-100 text-neutral-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="bg-neutral-50 p-3.5 rounded-xl border border-black/5 space-y-2">
                <div className="flex justify-between font-medium">
                  <span className="text-neutral-500">Autonomous budget cap:</span>
                  <span className="text-neutral-900">₹{config ? config.policy.max_autonomous_checkout_paise / 100 : 700}</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span className="text-neutral-500">Quote expiration TTL:</span>
                  <span className="text-neutral-900">{config ? config.policy.quote_expiry_seconds : 600} seconds</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span className="text-neutral-500">Active bundle pairing:</span>
                  <span className="text-violet-700 font-semibold">{bundle?.name || "Complete Outfit"} ({bundle?.discount_percent}% off)</span>
                </div>
              </div>

              <div>
                <label className="block text-neutral-600 font-medium mb-1">
                  Change summary note (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Updated bundle pairing and seasonal discount limit"
                  value={customSummaryNote}
                  onChange={(e) => setCustomSummaryNote(e.target.value)}
                  className="w-full bg-neutral-50 border border-black/10 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-neutral-900"
                />
              </div>

              <div className="p-3 bg-violet-50/70 border border-violet-200/60 rounded-xl text-[11px] text-violet-800 leading-relaxed">
                <strong>Treatment of existing quotes:</strong> Previously issued HMAC quotes continue under their embedded policy version until expiration (600s). New quotes will bind this updated policy version.
              </div>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-3 border-t border-black/10">
              <button
                onClick={() => setShowPublishDiff(false)}
                className="px-4 py-2 border border-black/10 rounded-xl text-xs font-medium text-neutral-600 hover:bg-neutral-100"
              >
                Cancel
              </button>
              <button
                onClick={handleExecutePublish}
                disabled={saving}
                className="px-4 py-2 bg-neutral-900 text-white rounded-xl text-xs font-semibold hover:bg-neutral-800 shadow-sm disabled:opacity-50 flex items-center space-x-1.5"
              >
                {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                <span>{saving ? "Publishing..." : "Confirm & Publish Policy"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: "WHY THIS DECISION?" TRACE ================= */}
      {selectedTrace && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-black/10 rounded-2xl max-w-2xl w-full p-6 space-y-5 shadow-xl max-h-[90vh] overflow-y-auto animate-scale-up">
            <div className="flex items-center justify-between pb-3 border-b border-black/10">
              <div>
                <h3 className="text-base font-semibold text-neutral-900">Decision Trace</h3>
                <p className="text-xs text-neutral-500">Deterministic policy evaluation audit without black-box opacity.</p>
              </div>
              <button
                onClick={() => setSelectedTrace(null)}
                className="p-1 rounded-lg hover:bg-neutral-100 text-neutral-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Trace content */}
            <div className="space-y-4 text-xs">
              <div className="p-3 bg-neutral-50 rounded-xl border border-black/5 space-y-1">
                <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider block">1. Buyer Intent Summary</span>
                <p className="font-medium text-neutral-900">{selectedTrace.buyer_intent}</p>
              </div>

              <div className="p-3 bg-neutral-50 rounded-xl border border-black/5 space-y-1">
                <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider block">2. Matched Products & Policy Snapshot</span>
                <p className="font-semibold text-neutral-900">{selectedTrace.matched_products.join(", ")}</p>
                <p className="text-neutral-500 text-[11px] mt-0.5">Evaluated under immutable snapshot: <strong>{selectedTrace.policy_version}</strong></p>
              </div>

              {selectedTrace.arithmetic && (
                <div className="p-3 bg-neutral-50 rounded-xl border border-black/5 space-y-2">
                  <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider block">3. Exact Arithmetic Breakdown</span>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>Subtotal: <strong className="text-neutral-900">₹{selectedTrace.arithmetic.subtotal}</strong></div>
                    <div>Combo Discount: <strong className="text-emerald-700">-₹{selectedTrace.arithmetic.discount}</strong></div>
                    <div>Final Captured: <strong className="text-violet-700">₹{selectedTrace.arithmetic.final_total}</strong></div>
                    <div>Buyer Savings: <strong className="text-emerald-700">₹{selectedTrace.arithmetic.buyer_savings}</strong></div>
                  </div>
                </div>
              )}

              <div className="p-3 bg-neutral-50 rounded-xl border border-black/5 space-y-2">
                <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider block">4. Gate Evaluation Results</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {Object.entries(selectedTrace.gate_results).map(([gate, res]) => (
                    <div key={gate} className="flex items-center justify-between p-2 rounded-lg bg-white border border-black/5">
                      <span className="text-neutral-700">{gate}:</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        res === "PASS" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                      }`}>
                        {res}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-neutral-900 text-white space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 block">5. Final Outcome</span>
                <p className="font-bold text-sm text-white">Status: {selectedTrace.outcome}</p>
                <p className="text-xs text-neutral-300 leading-relaxed">{selectedTrace.business_reason}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: VIEW POLICY SNAPSHOT ================= */}
      {selectedSnapshot && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-black/10 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-xl animate-scale-up">
            <div className="flex items-center justify-between pb-3 border-b border-black/10">
              <div>
                <h3 className="text-base font-semibold text-neutral-900">Policy Snapshot {selectedSnapshot.version}</h3>
                <p className="text-xs text-neutral-500">Created on {new Date(selectedSnapshot.created_at).toLocaleString()}</p>
              </div>
              <button
                onClick={() => setSelectedSnapshot(null)}
                className="p-1 rounded-lg hover:bg-neutral-100 text-neutral-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-neutral-50 rounded-xl border border-black/5">
                <span className="text-[11px] font-semibold text-neutral-500 uppercase block mb-1">Change Summary</span>
                <p className="font-medium text-neutral-900">{selectedSnapshot.change_summary}</p>
              </div>

              <div className="p-3 bg-neutral-50 rounded-xl border border-black/5 space-y-2">
                <div className="flex justify-between">
                  <span className="text-neutral-500">Autonomous budget cap:</span>
                  <span className="font-semibold text-neutral-900">₹{selectedSnapshot.policy.max_autonomous_checkout_paise / 100}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Quote expiration TTL:</span>
                  <span className="font-semibold text-neutral-900">{selectedSnapshot.policy.quote_expiry_seconds}s</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Require UPI Mandate:</span>
                  <span className="font-semibold text-neutral-900">{selectedSnapshot.policy.mandate_required ? "Yes" : "No"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Recommend bundles:</span>
                  <span className="font-semibold text-neutral-900">{selectedSnapshot.policy.agent_can_recommend_bundles ? "Yes" : "No"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Price negotiation:</span>
                  <span className="font-semibold text-neutral-900">{selectedSnapshot.policy.agent_can_negotiate ? "Yes" : "No"}</span>
                </div>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setSelectedSnapshot(null)}
                className="px-4 py-2 border border-black/10 rounded-xl text-xs font-medium text-neutral-700 hover:bg-neutral-100"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
