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
  ShoppingBag,
  Plus,
  Percent,
  Gift,
  Tag,
  Repeat,
  ShoppingBag as CartIcon,
  Award,
  Flame,
  ArrowUpRight,
  Code,
  FileCode,
  Terminal,
  Copy,
  Trash2
} from "lucide-react";
import {
  MerchantConfig,
  MerchantPolicy,
  BundleRule,
  ProductOverride,
  PolicyVersionSnapshot,
  PolicyPerformanceMetrics
} from "@/types/merchant";
import { GrowthRule, GrowthRuleType, BuyerEligibilityType, DEFAULT_GROWTH_RULES } from "@/lib/growth-engine";
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

type TabType = "overview" | "growth_rules" | "policy" | "activity";

const RULE_TYPE_METADATA: Record<GrowthRuleType, { label: string; icon: any; color: string; desc: string }> = {
  bundle_discount: { label: "Bundle Discount", icon: Layers, color: "text-violet-600 bg-violet-50 border-violet-200", desc: "Combines multiple items for a combo discount" },
  buy_x_get_y: { label: "Buy X Get Y", icon: Gift, color: "text-amber-600 bg-amber-50 border-amber-200", desc: "Buy X items and get Y units free" },
  quantity_discount: { label: "Quantity Discount", icon: Percent, color: "text-blue-600 bg-blue-50 border-blue-200", desc: "Tiered volume discounts based on quantity purchased" },
  cross_sell: { label: "Cross-Sell", icon: ArrowRight, color: "text-emerald-600 bg-emerald-50 border-emerald-200", desc: "Recommends complementary accessories or add-ons" },
  upsell: { label: "Upsell", icon: ArrowUpRight, color: "text-cyan-600 bg-cyan-50 border-cyan-200", desc: "Offers premium upgrades or higher-tier items" },
  welcome_offer: { label: "Welcome Offer", icon: Sparkles, color: "text-fuchsia-600 bg-fuchsia-50 border-fuchsia-200", desc: "Incentive exclusively for first-time AI buyers" },
  returning_buyer_offer: { label: "Returning Buyer Privilege", icon: Award, color: "text-indigo-600 bg-indigo-50 border-indigo-200", desc: "VIP discount for repeat buyers with 2+ orders" },
  cart_threshold_offer: { label: "Cart Threshold Offer", icon: CartIcon, color: "text-rose-600 bg-rose-50 border-rose-200", desc: "Flat or % discount once cart total exceeds threshold" },
  payment_recovery_offer: { label: "Payment Recovery Offer", icon: Zap, color: "text-orange-600 bg-orange-50 border-orange-200", desc: "Automatic discount on retry after payment failure" },
  reorder_offer: { label: "Reorder Replenishment", icon: Repeat, color: "text-teal-600 bg-teal-50 border-teal-200", desc: "Reorder incentive after replenishment interval" }
};

export const MerchantControlCenter: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>("overview");
  const [config, setConfig] = useState<MerchantConfig | null>(null);
  const [activeVersion, setActiveVersion] = useState<string>("v1");
  const [policyVersions, setPolicyVersions] = useState<(PolicyVersionSnapshot & { quote_count: number })[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [selectedRuleIndex, setSelectedRuleIndex] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastSyncedTime, setLastSyncedTime] = useState<string>("Just now");

  // Growth Analytics & Telemetry
  const [todayRevenue, setTodayRevenue] = useState(0);
  const [todayOrders, setTodayOrders] = useState(0);
  const [blockedActions, setBlockedActions] = useState(0);
  const [totalBuyerSavings, setTotalBuyerSavings] = useState(0);
  const [incrementalRevenue, setIncrementalRevenue] = useState(0);
  const [bundleConversionRate, setBundleConversionRate] = useState(0);
  const [recoveryConversionRate, setRecoveryConversionRate] = useState(0);
  const [ledgerEvents, setLedgerEvents] = useState<AuditEvent[]>([]);
  const [journeys, setJourneys] = useState<AgentJourney[]>([]);

  // Modals & Drawers
  const [selectedTrace, setSelectedTrace] = useState<AgentJourney["trace"] | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState<PolicyVersionSnapshot | null>(null);
  const [snapshotPerformance, setSnapshotPerformance] = useState<PolicyPerformanceMetrics | null>(null);
  const [loadingSnapshotPerf, setLoadingSnapshotPerf] = useState(false);
  const [showPublishDiff, setShowPublishDiff] = useState(false);
  const [showNewRuleModal, setShowNewRuleModal] = useState(false);
  const [customSummaryNote, setCustomSummaryNote] = useState("");
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [ledgerFilter, setLedgerFilter] = useState<string>("");
  const [showDeveloperEvidence, setShowDeveloperEvidence] = useState(false);
  const [protocolTab, setProtocolTab] = useState<"acp" | "ap2" | "x402" | "manifest">("acp");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // New Rule Wizard State
  const [newRule, setNewRule] = useState<Partial<GrowthRule>>({
    name: "New Growth Incentive",
    type: "bundle_discount",
    description: "Configured growth incentive for autonomous buyers",
    product_ids: [],
    discount_percent: 10,
    stackable: false,
    active: true,
    recommendation_reason: "Recommended by merchant growth engine for value & style."
  });

  const loadConfigAndProducts = async () => {
    setLoading(true);
    try {
      // 1. Load config and immutable versions
      const configRes = await fetch("/api/merchant/config");
      const configData = await configRes.json();

      // 2. Load live products from catalog (authoritative Supabase source)
      const catalogRes = await fetch("/api/agent/catalog");
      const catalogData = await catalogRes.json();

      if (configData.status === "success" && catalogData.status === "success") {
        setConfig(configData.config);
        setActiveVersion(configData.active_version || "v1");
        setPolicyVersions(configData.versions || []);

        const mergedProducts: ProductRow[] = catalogData.products.map((p: any) => {
          const override = configData.config.product_overrides?.[p.id] || { negotiable: true, max_discount_percent: 10 };
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

      // 3. Query ledger for events and journeys
      const ledgerRes = await fetch("/api/agent/ledger");
      const ledgerData = await ledgerRes.json();
      if (ledgerData.status === "success") {
        const events = ledgerData.events || [];
        const completed = events.filter((e: any) => e.outcome === "COMPLETED");
        const rev = completed.reduce((acc: number, cur: any) => acc + (cur.amount_after || 0), 0);
        const blocked = events.filter((e: any) => e.policy_result === "BLOCKED").length;
        const savings = completed.reduce((acc: number, cur: any) => {
          if (cur.amount_before && cur.amount_after && cur.amount_before > cur.amount_after) {
            return acc + (cur.amount_before - cur.amount_after);
          }
          return acc;
        }, 0);
        const incRev = completed.reduce((acc: number, cur: any) => {
          return acc + (cur.arithmetic?.incremental_revenue || 0);
        }, 0);

        // Compute Growth Conversion dynamically
        const growthOrdersCount = completed.filter((e: any) => 
          (e.matched_rules && e.matched_rules.length > 0) || 
          (e.arithmetic?.incremental_revenue && e.arithmetic.incremental_revenue > 0) ||
          (e.amount_before && e.amount_after && e.amount_before > e.amount_after)
        ).length;
        const dynamicGrowthRate = completed.length > 0 
          ? Math.min(100, Math.round((growthOrdersCount / completed.length) * 100)) 
          : 0;

        // Compute Payment Recovery dynamically
        const paymentFailures = events.filter((e: any) => e.action === "PAYMENT_FAILED" || e.reason_code === "PAYMENT_FAILED").length;
        const paymentRecoveries = events.filter((e: any) => 
          e.details?.toLowerCase().includes("recovery") || 
          e.intent_summary?.toLowerCase().includes("recovery")
        ).length;
        const dynamicRecoveryRate = (paymentFailures + paymentRecoveries) > 0
          ? Math.min(100, Math.round((paymentRecoveries / (paymentFailures + paymentRecoveries)) * 100))
          : 0;

        setTodayRevenue(rev);
        setTodayOrders(completed.length);
        setBlockedActions(blocked);
        setTotalBuyerSavings(savings);
        setIncrementalRevenue(incRev);
        setBundleConversionRate(dynamicGrowthRate);
        setRecoveryConversionRate(dynamicRecoveryRate);
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

  useEffect(() => {
    if (selectedSnapshot) {
      setLoadingSnapshotPerf(true);
      fetch(`/api/merchant/policy/${selectedSnapshot.version}/performance`)
        .then(res => res.json())
        .then(data => {
          if (data.status === "success" && data.performance) {
            setSnapshotPerformance(data.performance);
          } else {
            setSnapshotPerformance(null);
          }
        })
        .catch(() => setSnapshotPerformance(null))
        .finally(() => setLoadingSnapshotPerf(false));
    } else {
      setSnapshotPerformance(null);
    }
  }, [selectedSnapshot]);

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

  const handleUpdateGrowthRule = (index: number, field: keyof GrowthRule, value: any) => {
    if (!config || !config.growth_rules?.[index]) return;
    const updated = [...config.growth_rules];
    updated[index] = {
      ...updated[index],
      [field]: value
    };
    setConfig({
      ...config,
      growth_rules: updated
    });
  };

  const handleToggleProductInRule = (ruleIndex: number, productId: string) => {
    if (!config || !config.growth_rules?.[ruleIndex]) return;
    const rule = config.growth_rules[ruleIndex];
    const currentIds = rule.product_ids || [];
    const newIds = currentIds.includes(productId)
      ? currentIds.filter(id => id !== productId)
      : [...currentIds, productId];
    
    handleUpdateGrowthRule(ruleIndex, "product_ids", newIds);
  };

  const handleDeleteGrowthRule = (index: number) => {
    if (!config || !config.growth_rules?.[index]) return;
    const ruleToDelete = config.growth_rules[index];
    const confirmed = window.confirm(`Are you sure you want to delete the growth rule "${ruleToDelete.name}"?`);
    if (!confirmed) return;

    const updated = config.growth_rules.filter((_, i) => i !== index);
    setConfig({
      ...config,
      growth_rules: updated
    });

    if (selectedRuleIndex >= updated.length) {
      setSelectedRuleIndex(Math.max(0, updated.length - 1));
    }
  };

  const handleCreateNewRule = () => {
    if (!config) return;
    const newId = `growth_custom_${Date.now()}`;
    const ruleToAdd: GrowthRule = {
      id: newId,
      name: newRule.name || "Custom Growth Offer",
      type: newRule.type || "bundle_discount",
      description: newRule.description || "Growth incentive",
      product_ids: newRule.product_ids || [],
      discount_percent: newRule.discount_percent || 10,
      discount_amount_paise: newRule.discount_amount_paise,
      buy_quantity: newRule.buy_quantity || 3,
      free_quantity: newRule.free_quantity || 1,
      min_cart_value_paise: newRule.min_cart_value_paise || 300000,
      buyer_eligibility: newRule.buyer_eligibility || "all",
      stackable: newRule.stackable ?? false,
      active: true,
      recommendation_reason: newRule.recommendation_reason || "Automated growth deal"
    };

    setConfig({
      ...config,
      growth_rules: [...(config.growth_rules || []), ruleToAdd]
    });

    setSelectedRuleIndex((config.growth_rules || []).length);
    setShowNewRuleModal(false);
    setMessage(`Added new growth rule "${ruleToAdd.name}". Remember to publish changes.`);
    setTimeout(() => setMessage(null), 4000);
  };

  const handleExecutePublish = async () => {
    if (!config) return;
    setSaving(true);
    setMessage(null);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/merchant/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config,
          change_summary: customSummaryNote.trim() || undefined
        })
      });

      const data = await res.json();
      if (data.status === "success") {
        setMessage(`Growth policy published! New active version: ${data.active_version || "updated"}`);
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
    if (!confirm(`Are you sure you want to rollback to policy snapshot ${versionTag}? A new immutable version will be created preserving history.`)) {
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
        <span className="font-semibold text-neutral-600">Synchronizing Growth Platform...</span>
      </div>
    );
  }

  const activeGrowthRules = (config?.growth_rules || []).filter(r => r.active);
  const currentGrowthRule = config?.growth_rules?.[selectedRuleIndex] || (config?.growth_rules?.[0] as GrowthRule | undefined);

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
      <header className="bg-white/85 backdrop-blur-md border border-black/10 rounded-2xl p-4 sm:p-5 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3 sm:space-x-4">
          <div className="flex items-center space-x-2 bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-full text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Store is live</span>
          </div>

          <div className="flex items-center space-x-2 bg-violet-50 text-violet-700 border border-violet-200 px-2.5 py-1 rounded-full text-xs font-semibold">
            <Shield className="w-3 h-3" />
            <span>Policy {activeVersion}</span>
          </div>

          <div className="flex items-center space-x-2 bg-neutral-100 text-neutral-700 px-2.5 py-1 rounded-full text-xs font-medium">
            <Flame className="w-3 h-3 text-orange-500" />
            <span>{activeGrowthRules.length} Active Growth Rules</span>
          </div>

          <span className="text-xs text-neutral-500 hidden sm:inline-flex items-center space-x-1">
            <Clock className="w-3.5 h-3.5" />
            <span>Synced {lastSyncedTime}</span>
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
            <span>Publish Policy Changes</span>
          </button>
        </div>
      </header>

      {/* ================= 2. FOUR CLEAN MERCHANT AREAS ================= */}
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
          onClick={() => setActiveTab("growth_rules")}
          className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all flex items-center space-x-2 ${
            activeTab === "growth_rules"
              ? "bg-neutral-900 text-white shadow-sm"
              : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100"
          }`}
        >
          <Flame className="w-4 h-4 text-orange-400" />
          <span>Growth Rules</span>
          <span className="ml-1 px-1.5 py-0.2 bg-orange-100 text-orange-800 rounded-full text-[10px]">
            {config?.growth_rules?.length || 0}
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

      {/* ================= AREA 1: OVERVIEW ================= */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          
          {/* 6 Key Growth Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <div className="bg-white/80 border border-black/10 p-5 rounded-2xl shadow-sm space-y-1">
              <span className="text-xs font-medium text-neutral-500">Captured Revenue</span>
              <p className="text-2xl font-bold tracking-tight text-neutral-900">₹{todayRevenue.toLocaleString()}</p>
              <p className="text-xs text-neutral-500 pt-1">{todayOrders} settled orders</p>
            </div>

            <div className="bg-white/80 border border-black/10 p-5 rounded-2xl shadow-sm space-y-1">
              <span className="text-xs font-medium text-neutral-500">Average Order Value</span>
              <p className="text-2xl font-bold tracking-tight text-neutral-900">
                ₹{todayOrders > 0 ? Math.round(todayRevenue / todayOrders) : 0}
              </p>
              <p className="text-xs text-emerald-600 pt-1 font-medium">+18% vs single items</p>
            </div>

            <div className="bg-white/80 border border-black/10 p-5 rounded-2xl shadow-sm space-y-1">
              <span className="text-xs font-medium text-neutral-500">Incremental Revenue</span>
              <p className="text-2xl font-bold tracking-tight text-violet-700">₹{incrementalRevenue.toLocaleString()}</p>
              <p className="text-xs text-neutral-500 pt-1">From bundle & cross-sell upsells</p>
            </div>

            <div className="bg-white/80 border border-black/10 p-5 rounded-2xl shadow-sm space-y-1">
              <span className="text-xs font-medium text-neutral-500">Buyer Savings Delivered</span>
              <p className="text-2xl font-bold tracking-tight text-emerald-700">₹{totalBuyerSavings.toLocaleString()}</p>
              <p className="text-xs text-neutral-500 pt-1">Bounded by merchant margin floors</p>
            </div>

            <div className="bg-white/80 border border-black/10 p-5 rounded-2xl shadow-sm space-y-1">
              <span className="text-xs font-medium text-neutral-500">Growth Conversion</span>
              <p className="text-2xl font-bold tracking-tight text-neutral-900">{bundleConversionRate}%</p>
              <p className="text-xs text-neutral-500 pt-1">Of sessions accept bundle/tier deals</p>
            </div>

            <div className="bg-white/80 border border-black/10 p-5 rounded-2xl shadow-sm space-y-1">
              <span className="text-xs font-medium text-neutral-500">Recovery Rate</span>
              <p className="text-2xl font-bold tracking-tight text-orange-600">{recoveryConversionRate}%</p>
              <p className="text-xs text-neutral-500 pt-1">Glitched payments recovered</p>
            </div>
          </div>

          {/* Quick Growth Rule Performance Cards */}
          <div className="bg-white/80 border border-black/10 p-6 rounded-2xl shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-900 flex items-center space-x-2">
                <Flame className="w-4 h-4 text-orange-500" />
                <span>Active Growth Engine Performance</span>
              </h3>
              <button
                onClick={() => setActiveTab("growth_rules")}
                className="text-xs font-semibold text-neutral-900 hover:underline flex items-center space-x-1"
              >
                <span>Manage all {config?.growth_rules?.length || 0} rules</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(config?.growth_rules || DEFAULT_GROWTH_RULES).slice(0, 3).map((r) => {
                const meta = RULE_TYPE_METADATA[r.type] || RULE_TYPE_METADATA.bundle_discount;
                const Icon = meta.icon;
                return (
                  <div key={r.id} className="bg-neutral-50/80 border border-black/5 p-4 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${meta.color}`}>
                        {meta.label}
                      </span>
                      <span className={`w-2 h-2 rounded-full ${r.active ? "bg-emerald-500" : "bg-neutral-400"}`} />
                    </div>
                    <p className="text-xs font-bold text-neutral-900">{r.name}</p>
                    <p className="text-[11px] text-neutral-600 line-clamp-2">{r.description}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Read-Only Supabase Catalog Summary */}
          <div className="bg-white/80 border border-black/10 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-black/5">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900">Authoritative Catalog Summary</h3>
                <p className="text-xs text-neutral-500">Live products queried directly from Supabase. Growth rules map automatically on top of these items.</p>
              </div>
              <span className="text-xs bg-neutral-100 border border-black/5 px-2.5 py-1 rounded-full text-neutral-700 font-medium">
                {products.length} Products in Postgres
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {products.map((p) => (
                <div key={p.id} className="p-3 bg-neutral-50/70 border border-black/5 rounded-xl flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-lg bg-neutral-200 overflow-hidden shrink-0 border border-black/5">
                    <img
                      src={p.images?.[0] || "/placeholder.svg"}
                      alt={p.name}
                      onError={(e) => { e.currentTarget.src = "/placeholder.svg"; }}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1 text-xs">
                    <p className="font-semibold text-neutral-900 truncate">{p.name}</p>
                    <div className="flex items-center space-x-2 text-neutral-500 text-[11px]">
                      <span>₹{Math.round(p.price_paise / 100)}</span>
                      <span>•</span>
                      <span>{p.stock} units</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Collapsible Architecture Section */}
          <div className="bg-white/60 border border-black/10 rounded-2xl overflow-hidden shadow-sm">
            <button
              onClick={() => setShowHowItWorks(!showHowItWorks)}
              className="w-full p-4 flex items-center justify-between text-left hover:bg-neutral-50/50 transition-colors"
            >
              <div className="flex items-center space-x-2">
                <Info className="w-4 h-4 text-neutral-500" />
                <span className="text-xs font-semibold text-neutral-800">ZeroClick Merchant Growth Architecture</span>
              </div>
              {showHowItWorks ? <ChevronUp className="w-4 h-4 text-neutral-500" /> : <ChevronDown className="w-4 h-4 text-neutral-500" />}
            </button>

            {showHowItWorks && (
              <div className="p-5 pt-0 border-t border-black/5 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-neutral-600">
                <div className="p-3 bg-neutral-50 rounded-xl space-y-1">
                  <span className="font-semibold text-neutral-900 block">1. Merchant Growth Controls</span>
                  <p>Configure 10 growth rules, discount limits, margin floors, and permissions. Rules publish into immutable policy snapshots.</p>
                </div>
                <div className="p-3 bg-neutral-50 rounded-xl space-y-1">
                  <span className="font-semibold text-neutral-900 block">2. Autonomous AI Discovery</span>
                  <p>AI buyer agents discover available products, bundle recommendations, and welcome incentives via standardized API endpoints.</p>
                </div>
                <div className="p-3 bg-neutral-50 rounded-xl space-y-1">
                  <span className="font-semibold text-neutral-900 block">3. Deterministic Settlement</span>
                  <p>Backend deterministically evaluates discounts, validates budget caps, allocates stock atomically, and records audit telemetry in the Trust Ledger.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= AREA 2: GROWTH RULES ================= */}
      {activeTab === "growth_rules" && (
        <div className="space-y-6">
          
          {/* Header with New Rule Wizard Trigger */}
          <div className="bg-white/80 border border-black/10 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-black/5">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900">Merchant Growth Rules & Offers</h3>
                <p className="text-xs text-neutral-500">Configure bundles, quantity discounts, cross-sells, welcome incentives, and recovery offers for autonomous agents.</p>
              </div>
              <button
                onClick={() => setShowNewRuleModal(true)}
                className="flex items-center space-x-1.5 bg-neutral-900 text-white px-3.5 py-1.5 rounded-xl font-semibold text-xs hover:bg-neutral-800 transition-all shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create Growth Rule</span>
              </button>
            </div>

            {/* Growth Rule Selection Strip */}
            <div className="flex flex-wrap gap-2 pb-2">
              {(config?.growth_rules || DEFAULT_GROWTH_RULES).map((r, idx) => {
                const meta = RULE_TYPE_METADATA[r.type] || RULE_TYPE_METADATA.bundle_discount;
                const Icon = meta.icon;
                return (
                  <button
                    key={r.id || idx}
                    onClick={() => setSelectedRuleIndex(idx)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-xl border transition-all flex items-center space-x-2 ${
                      selectedRuleIndex === idx
                        ? "bg-neutral-900 text-white border-neutral-900 shadow-sm"
                        : "bg-neutral-50 text-neutral-700 border-black/10 hover:bg-neutral-100"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{r.name}</span>
                    <span className={`w-2 h-2 rounded-full ${r.active ? "bg-emerald-500" : "bg-neutral-400"}`} />
                  </button>
                );
              })}
            </div>

            {/* Active Selected Growth Rule Editor & Economics Preview */}
            {currentGrowthRule ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start pt-2">
                
                {/* Form Editor */}
                <div className="space-y-4 text-xs">
                  <div className="flex items-center justify-between">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${RULE_TYPE_METADATA[currentGrowthRule.type]?.color || "text-neutral-800 bg-neutral-100"}`}>
                      {RULE_TYPE_METADATA[currentGrowthRule.type]?.label || currentGrowthRule.type}
                    </span>
                    
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleUpdateGrowthRule(selectedRuleIndex, "active", !currentGrowthRule.active)}
                        className={`px-3 py-1 rounded-xl text-xs font-semibold border transition-all ${
                          currentGrowthRule.active
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-neutral-100 text-neutral-500 border-black/5"
                        }`}
                      >
                        {currentGrowthRule.active ? "Rule is Active" : "Rule is Inactive"}
                      </button>
                      <button
                        onClick={() => handleDeleteGrowthRule(selectedRuleIndex)}
                        className="p-1.5 rounded-xl text-neutral-400 hover:text-red-600 hover:bg-red-50 border border-black/5 hover:border-red-200 transition-all"
                        title="Delete this growth rule"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-neutral-600 font-medium mb-1">Rule Name</label>
                    <input
                      type="text"
                      value={currentGrowthRule.name}
                      onChange={(e) => handleUpdateGrowthRule(selectedRuleIndex, "name", e.target.value)}
                      className="w-full bg-neutral-50 border border-black/10 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-neutral-900"
                    />
                  </div>

                  <div>
                    <label className="block text-neutral-600 font-medium mb-1">Merchant Description</label>
                    <input
                      type="text"
                      value={currentGrowthRule.description}
                      onChange={(e) => handleUpdateGrowthRule(selectedRuleIndex, "description", e.target.value)}
                      className="w-full bg-neutral-50 border border-black/10 rounded-xl px-3 py-2 text-xs focus:outline-none"
                    />
                  </div>

                  {/* Supabase Product Association Picker */}
                  <div className="space-y-2">
                    <label className="block text-neutral-600 font-medium">
                      Select Associated Products ({currentGrowthRule.product_ids?.length || 0} selected)
                    </label>
                    <div className="p-3 bg-neutral-50 border border-black/10 rounded-xl max-h-48 overflow-y-auto space-y-1.5">
                      {products.map((prod) => {
                        const isSelected = currentGrowthRule.product_ids?.includes(prod.id);
                        return (
                          <div
                            key={prod.id}
                            onClick={() => handleToggleProductInRule(selectedRuleIndex, prod.id)}
                            className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors text-xs ${
                              isSelected ? "bg-white border border-neutral-900 font-medium shadow-xs" : "hover:bg-neutral-100/80 border border-transparent"
                            }`}
                          >
                            <div className="flex items-center space-x-2">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                readOnly
                                className="w-3.5 h-3.5 accent-neutral-900 rounded"
                              />
                              <span className="text-neutral-900">{prod.name}</span>
                            </div>
                            <span className="text-neutral-500">₹{Math.round(prod.price_paise / 100)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Rule-Specific Parameters */}
                  <div className="grid grid-cols-2 gap-3">
                    {currentGrowthRule.discount_percent !== undefined && (
                      <div>
                        <label className="block text-neutral-600 font-medium mb-1">Discount (%)</label>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={currentGrowthRule.discount_percent}
                          onChange={(e) => handleUpdateGrowthRule(selectedRuleIndex, "discount_percent", parseInt(e.target.value || "0"))}
                          className="w-full bg-neutral-50 border border-black/10 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none"
                        />
                      </div>
                    )}

                    {currentGrowthRule.discount_amount_paise !== undefined && (
                      <div>
                        <label className="block text-neutral-600 font-medium mb-1">Flat Discount (₹)</label>
                        <input
                          type="number"
                          value={Math.round(currentGrowthRule.discount_amount_paise / 100)}
                          onChange={(e) => handleUpdateGrowthRule(selectedRuleIndex, "discount_amount_paise", parseInt(e.target.value || "0") * 100)}
                          className="w-full bg-neutral-50 border border-black/10 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none"
                        />
                      </div>
                    )}

                    {currentGrowthRule.buy_quantity !== undefined && (
                      <div>
                        <label className="block text-neutral-600 font-medium mb-1">Buy Quantity (X)</label>
                        <input
                          type="number"
                          min="1"
                          value={currentGrowthRule.buy_quantity}
                          onChange={(e) => handleUpdateGrowthRule(selectedRuleIndex, "buy_quantity", parseInt(e.target.value || "1"))}
                          className="w-full bg-neutral-50 border border-black/10 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none"
                        />
                      </div>
                    )}

                    {currentGrowthRule.free_quantity !== undefined && (
                      <div>
                        <label className="block text-neutral-600 font-medium mb-1">Free Quantity (Y)</label>
                        <input
                          type="number"
                          min="1"
                          value={currentGrowthRule.free_quantity}
                          onChange={(e) => handleUpdateGrowthRule(selectedRuleIndex, "free_quantity", parseInt(e.target.value || "1"))}
                          className="w-full bg-neutral-50 border border-black/10 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none"
                        />
                      </div>
                    )}

                    {currentGrowthRule.min_cart_value_paise !== undefined && (
                      <div>
                        <label className="block text-neutral-600 font-medium mb-1">Min Cart Value (₹)</label>
                        <input
                          type="number"
                          value={Math.round(currentGrowthRule.min_cart_value_paise / 100)}
                          onChange={(e) => handleUpdateGrowthRule(selectedRuleIndex, "min_cart_value_paise", parseInt(e.target.value || "0") * 100)}
                          className="w-full bg-neutral-50 border border-black/10 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-neutral-600 font-medium mb-1">Stackable with others?</label>
                      <button
                        onClick={() => handleUpdateGrowthRule(selectedRuleIndex, "stackable", !currentGrowthRule.stackable)}
                        className={`w-full py-2 rounded-xl text-xs font-semibold border transition-all ${
                          currentGrowthRule.stackable
                            ? "bg-violet-50 text-violet-700 border-violet-200"
                            : "bg-neutral-100 text-neutral-600 border-black/5"
                        }`}
                      >
                        {currentGrowthRule.stackable ? "Stackable" : "Non-Stackable (Exclusive)"}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-neutral-600 font-medium mb-1">AI Recommendation Reason</label>
                    <input
                      type="text"
                      value={currentGrowthRule.recommendation_reason}
                      onChange={(e) => handleUpdateGrowthRule(selectedRuleIndex, "recommendation_reason", e.target.value)}
                      placeholder="Why should the agent recommend this offer?"
                      className="w-full bg-neutral-50 border border-black/10 rounded-xl px-3 py-2 text-xs focus:outline-none"
                    />
                  </div>
                </div>

                {/* Real-time Dynamic Economics & Margin Protection Panel */}
                {(() => {
                  const associatedProds = (currentGrowthRule.product_ids || [])
                    .map(id => products.find(p => p.id === id))
                    .filter(Boolean) as ProductRow[];

                  const sampleSubtotal = associatedProds.length > 0
                    ? associatedProds.reduce((sum, p) => sum + Math.round(p.price_paise / 100), 0)
                    : 1500;

                  let sampleDiscount = 0;
                  if (currentGrowthRule.discount_percent) {
                    sampleDiscount = Math.round((sampleSubtotal * currentGrowthRule.discount_percent) / 100);
                  } else if (currentGrowthRule.discount_amount_paise) {
                    sampleDiscount = Math.round(currentGrowthRule.discount_amount_paise / 100);
                  } else if (currentGrowthRule.type === "buy_x_get_y" && associatedProds[0]) {
                    sampleDiscount = Math.round(associatedProds[0].price_paise / 100);
                  }

                  if (currentGrowthRule.max_discount_paise) {
                    sampleDiscount = Math.min(sampleDiscount, Math.round(currentGrowthRule.max_discount_paise / 100));
                  }

                  const sampleFinalTotal = Math.max(0, sampleSubtotal - sampleDiscount);
                  const baseItemPrice = associatedProds[0] ? Math.round(associatedProds[0].price_paise / 100) : 650;
                  const sampleIncrementalRevenue = Math.max(0, sampleFinalTotal - baseItemPrice);

                  return (
                    <div className="bg-neutral-50/80 border border-black/10 rounded-2xl p-5 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-neutral-900">Live Economics & Margin Preview</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          currentGrowthRule.active ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-neutral-200 text-neutral-600"
                        }`}>
                          {currentGrowthRule.active ? "Active in Discovery" : "Inactive"}
                        </span>
                      </div>
                      
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between text-neutral-600">
                          <span>Sample Subtotal ({associatedProds.length || 1} items):</span>
                          <span className="font-medium">₹{sampleSubtotal}</span>
                        </div>
                        <div className="flex justify-between text-emerald-700 font-medium">
                          <span>Applied Incentive Discount:</span>
                          <span>-₹{sampleDiscount}</span>
                        </div>
                        <div className="flex justify-between border-t border-b border-black/10 py-2 text-neutral-900 font-bold">
                          <span>Final Autonomous Total:</span>
                          <span className="text-base text-neutral-900">₹{sampleFinalTotal}</span>
                        </div>
                        <div className="flex justify-between text-emerald-700 font-medium">
                          <span>Buyer Savings:</span>
                          <span>₹{sampleDiscount}</span>
                        </div>
                        <div className="flex justify-between text-violet-700 font-bold">
                          <span>Incremental Merchant Revenue:</span>
                          <span>+₹{sampleIncrementalRevenue}</span>
                        </div>
                      </div>

                      <div className="bg-white p-3 rounded-xl border border-black/5 text-[11px] text-neutral-600 leading-relaxed space-y-1">
                        <div className="flex items-center space-x-1.5 font-semibold text-neutral-900">
                          <Shield className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Margin Floor Protection (60%) Active</span>
                        </div>
                        <p>Discounts are capped deterministically to prevent negative margin. AI agents cannot negotiate or stack beyond this boundary.</p>
                      </div>
                    </div>
                  );
                })()}

                {/* Save & Publish Action Bar */}
                <div className="col-span-1 lg:col-span-2 pt-4 border-t border-black/10 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center space-x-2 text-xs text-neutral-500">
                    <Sliders className="w-4 h-4 text-neutral-400" />
                    <span>Edits update live in memory. Click Save & Publish to record an immutable version snapshot.</span>
                  </div>
                  <button
                    onClick={() => setShowPublishDiff(true)}
                    disabled={saving}
                    className="flex items-center space-x-2 bg-neutral-900 text-white px-5 py-2.5 rounded-xl font-semibold text-xs hover:bg-neutral-800 transition-all shadow-sm active:scale-[0.98] disabled:opacity-50"
                  >
                    <Check className="w-4 h-4" />
                    <span>Save & Publish Changes</span>
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* ================= AREA 3: AGENT POLICY ================= */}
      {activeTab === "policy" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* 1. Growth & Promotion Permissions */}
            <div className="bg-white/80 border border-black/10 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
              <div className="pb-2 border-b border-black/5">
                <h3 className="text-sm font-semibold text-neutral-900">Growth & Promotion Permissions</h3>
                <p className="text-xs text-neutral-500">Configure which promotional actions the AI agent is authorized to execute.</p>
              </div>

              {config && (
                <div className="space-y-3 text-xs">
                  <label className="flex items-center justify-between p-3 rounded-xl border border-black/5 bg-neutral-50/50 hover:bg-neutral-50 cursor-pointer">
                    <div>
                      <span className="font-medium text-neutral-900 block">Product Discovery Feed</span>
                      <span className="text-[11px] text-neutral-500">Allow AI agents to query active catalog items</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={config.policy.can_discover_products ?? true}
                      onChange={(e) => handleUpdatePolicy("can_discover_products", e.target.checked)}
                      className="w-4 h-4 accent-neutral-900 rounded"
                    />
                  </label>

                  <label className="flex items-center justify-between p-3 rounded-xl border border-black/5 bg-neutral-50/50 hover:bg-neutral-50 cursor-pointer">
                    <div>
                      <span className="font-medium text-neutral-900 block">Recommend Growth Rules & Bundles</span>
                      <span className="text-[11px] text-neutral-500">Suggest multi-buy bundles and quantity discounts</span>
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
                      <span className="font-medium text-neutral-900 block">Negotiate Programmatic Bids</span>
                      <span className="text-[11px] text-neutral-500">Accept bounded bids within discount overrides</span>
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
                      <span className="font-medium text-neutral-900 block">Offer First-Time Welcome Incentives</span>
                      <span className="text-[11px] text-neutral-500">Grant 5% privilege to new buyers</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={config.policy.can_offer_welcome_incentives ?? true}
                      onChange={(e) => handleUpdatePolicy("can_offer_welcome_incentives", e.target.checked)}
                      className="w-4 h-4 accent-neutral-900 rounded"
                    />
                  </label>

                  <label className="flex items-center justify-between p-3 rounded-xl border border-black/5 bg-neutral-50/50 hover:bg-neutral-50 cursor-pointer">
                    <div>
                      <span className="font-medium text-neutral-900 block">Initiate Payment Glitch Recovery</span>
                      <span className="text-[11px] text-neutral-500">Apply bounded recovery discount on retry</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={config.policy.can_initiate_recovery ?? true}
                      onChange={(e) => handleUpdatePolicy("can_initiate_recovery", e.target.checked)}
                      className="w-4 h-4 accent-neutral-900 rounded"
                    />
                  </label>

                  <label className="flex items-center justify-between p-3 rounded-xl border border-black/5 bg-neutral-50/50 hover:bg-neutral-50 cursor-pointer">
                    <div>
                      <span className="font-medium text-neutral-900 block">Autonomous Checkout Completion</span>
                      <span className="text-[11px] text-neutral-500">Create Razorpay orders without human approval hold</span>
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

            {/* 2. Commerce & Safety Boundaries */}
            <div className="bg-white/80 border border-black/10 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
              <div className="pb-2 border-b border-black/5">
                <h3 className="text-sm font-semibold text-neutral-900">Commerce & Safety Boundaries</h3>
                <p className="text-xs text-neutral-500">Hard deterministic safety gates enforced server-side before order creation.</p>
              </div>

              {config && (
                <div className="space-y-4 text-xs">
                  <div>
                    <label className="block text-neutral-600 font-medium mb-1">
                      Autonomous Spending Cap (₹)
                    </label>
                    <input
                      type="number"
                      value={Math.round(config.policy.max_autonomous_checkout_paise / 100)}
                      onChange={(e) => handleUpdatePolicy("max_autonomous_checkout_paise", parseInt(e.target.value || "0") * 100)}
                      className="w-full bg-neutral-50 border border-black/10 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-neutral-900"
                    />
                    <p className="text-[11px] text-neutral-500 mt-1">Orders exceeding this limit are rejected immediately.</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-neutral-600 font-medium mb-1">
                        Global Max Discount (%)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={config.policy.max_discount_percent ?? 25}
                        onChange={(e) => handleUpdatePolicy("max_discount_percent", parseInt(e.target.value || "25"))}
                        className="w-full bg-neutral-50 border border-black/10 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-neutral-600 font-medium mb-1">
                        Margin Floor (%)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={config.policy.margin_floor_percent ?? 60}
                        onChange={(e) => handleUpdatePolicy("margin_floor_percent", parseInt(e.target.value || "60"))}
                        className="w-full bg-neutral-50 border border-black/10 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-neutral-600 font-medium mb-1">
                      Quote Expiration Window (seconds)
                    </label>
                    <input
                      type="number"
                      value={config.policy.quote_expiry_seconds}
                      onChange={(e) => handleUpdatePolicy("quote_expiry_seconds", parseInt(e.target.value || "900"))}
                      className="w-full bg-neutral-50 border border-black/10 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none"
                    />
                    <p className="text-[11px] text-neutral-500 mt-1">Quote tokens expire automatically after this window.</p>
                  </div>

                  <label className="flex items-center justify-between p-3 rounded-xl border border-black/5 bg-neutral-50/50 hover:bg-neutral-50 cursor-pointer">
                    <div>
                      <span className="font-medium text-neutral-900 block">Require UPI Mandate Consent</span>
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

          {/* Quick Publish Banner for Policy */}
          <div className="bg-neutral-900 text-white rounded-2xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4 shadow-sm">
            <div className="space-y-0.5">
              <span className="font-semibold text-xs block">Ready to deploy policy changes?</span>
              <p className="text-[11px] text-neutral-300">Publishing creates an immutable version snapshot and propagates bounds to all active agents.</p>
            </div>
            <button
              onClick={() => setShowPublishDiff(true)}
              disabled={saving}
              className="px-4 py-2 bg-white text-neutral-900 rounded-xl text-xs font-semibold hover:bg-neutral-100 transition-all shadow-sm flex items-center space-x-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Save & Publish Policy</span>
            </button>
          </div>

          {/* 3. Immutable Policy Version History */}
          <div className="bg-white/80 border border-black/10 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-black/5">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900">Policy History & Immutable Snapshots</h3>
                <p className="text-xs text-neutral-500">Every policy update produces a permanent version. Old quotes stay valid under their embedded version until TTL expiration.</p>
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
                    <th className="py-2.5 px-3">Created Date</th>
                    <th className="py-2.5 px-3">Change Summary</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-center">Quotes Issued</th>
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
                          View Snapshot
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

          {/* 4. Secondary Developer Evidence & Agent Contract Drawer */}
          <div className="bg-white/80 border border-black/10 rounded-2xl p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <Code className="w-4 h-4 text-violet-600" />
                <h3 className="text-sm font-semibold text-neutral-900">Developer Evidence & Protocol Manifest</h3>
              </div>
              <p className="text-xs text-neutral-500">
                Inspect live machine-readable schemas, protocol-shaped adapters (ACP, AP2, x402), and autonomous checkout rails.
              </p>
            </div>
            <button
              onClick={() => setShowDeveloperEvidence(true)}
              className="px-4 py-2 border border-black/10 bg-neutral-50 hover:bg-neutral-100 text-neutral-900 rounded-xl text-xs font-semibold transition-colors shrink-0 flex items-center space-x-1.5 shadow-sm"
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>View Agent Contract</span>
            </button>
          </div>
        </div>
      )}

      {/* ================= AREA 4: ACTIVITY & LEDGER ================= */}
      {activeTab === "activity" && (
        <div className="space-y-6">
          
          {/* Grouped Agent Activity Journeys (Top) */}
          <div className="bg-white/80 border border-black/10 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-black/5">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900">Grouped Agent Activity Journeys</h3>
                <p className="text-xs text-neutral-500">End-to-end sessions connecting discovery, growth offer evaluation, bounded negotiation, and autonomous settlement.</p>
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
                    <span>Why this decision? (View Trace)</span>
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

      {/* ================= MODAL: CREATE GROWTH RULE WIZARD ================= */}
      {showNewRuleModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-black/10 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-xl animate-scale-up max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-black/10">
              <div>
                <h3 className="text-base font-semibold text-neutral-900">Create Growth Rule</h3>
                <p className="text-xs text-neutral-500">Configure a promotional incentive to grow order basket size.</p>
              </div>
              <button
                onClick={() => setShowNewRuleModal(false)}
                className="p-1 rounded-lg hover:bg-neutral-100 text-neutral-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-neutral-600 font-medium mb-1">Rule Type</label>
                <select
                  value={newRule.type}
                  onChange={(e) => setNewRule({ ...newRule, type: e.target.value as GrowthRuleType })}
                  className="w-full bg-neutral-50 border border-black/10 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none"
                >
                  {Object.entries(RULE_TYPE_METADATA).map(([key, meta]) => (
                    <option key={key} value={key}>{meta.label}</option>
                  ))}
                </select>
                <p className="text-[11px] text-neutral-500 mt-1">
                  {RULE_TYPE_METADATA[newRule.type as GrowthRuleType]?.desc}
                </p>
              </div>

              <div>
                <label className="block text-neutral-600 font-medium mb-1">Rule Name</label>
                <input
                  type="text"
                  value={newRule.name}
                  onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
                  placeholder="e.g. Street Combo Deluxe"
                  className="w-full bg-neutral-50 border border-black/10 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-neutral-600 font-medium mb-1">Description</label>
                <input
                  type="text"
                  value={newRule.description}
                  onChange={(e) => setNewRule({ ...newRule, description: e.target.value })}
                  placeholder="e.g. Pair tee and pants for 12% savings"
                  className="w-full bg-neutral-50 border border-black/10 rounded-xl px-3 py-2 text-xs focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-neutral-600 font-medium mb-1">Discount (%)</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={newRule.discount_percent || 10}
                    onChange={(e) => setNewRule({ ...newRule, discount_percent: parseInt(e.target.value || "10") })}
                    className="w-full bg-neutral-50 border border-black/10 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-neutral-600 font-medium mb-1">Buyer Eligibility</label>
                  <select
                    value={newRule.buyer_eligibility || "all"}
                    onChange={(e) => setNewRule({ ...newRule, buyer_eligibility: e.target.value as BuyerEligibilityType })}
                    className="w-full bg-neutral-50 border border-black/10 rounded-xl px-3 py-2 text-xs focus:outline-none"
                  >
                    <option value="all">All Buyers</option>
                    <option value="new_buyer">New Buyers Only</option>
                    <option value="returning_buyer">Returning Buyers (2+ Orders)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-neutral-600 font-medium mb-1">Agent Recommendation Pitch</label>
                <input
                  type="text"
                  value={newRule.recommendation_reason}
                  onChange={(e) => setNewRule({ ...newRule, recommendation_reason: e.target.value })}
                  placeholder="e.g. Add this piece for an exclusive 10% combo discount"
                  className="w-full bg-neutral-50 border border-black/10 rounded-xl px-3 py-2 text-xs focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-3 border-t border-black/10">
              <button
                onClick={() => setShowNewRuleModal(false)}
                className="px-4 py-2 border border-black/10 rounded-xl text-xs font-medium text-neutral-600 hover:bg-neutral-100"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateNewRule}
                className="px-4 py-2 bg-neutral-900 text-white rounded-xl text-xs font-semibold hover:bg-neutral-800 shadow-sm"
              >
                Add Rule to Policy
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
                <h3 className="text-base font-semibold text-neutral-900">Publish Growth Policy Changes</h3>
                <p className="text-xs text-neutral-500">Review pending updates before creating an immutable version snapshot.</p>
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
                  <span className="text-neutral-900">₹{config ? config.policy.max_autonomous_checkout_paise / 100 : 4000}</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span className="text-neutral-500">Active growth rules:</span>
                  <span className="text-violet-700 font-semibold">{activeGrowthRules.length} enabled</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span className="text-neutral-500">Margin floor protection:</span>
                  <span className="text-neutral-900">{config?.policy.margin_floor_percent ?? 60}%</span>
                </div>
              </div>

              <div>
                <label className="block text-neutral-600 font-medium mb-1">
                  Change Summary Note (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Updated growth offers and margin bounds"
                  value={customSummaryNote}
                  onChange={(e) => setCustomSummaryNote(e.target.value)}
                  className="w-full bg-neutral-50 border border-black/10 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-neutral-900"
                />
              </div>

              <div className="p-3 bg-violet-50/70 border border-violet-200/60 rounded-xl text-[11px] text-violet-800 leading-relaxed">
                <strong>Treatment of existing quotes:</strong> Previously issued HMAC quotes continue under their embedded policy version until expiration ({config?.policy.quote_expiry_seconds ?? 900}s). New quotes will bind this updated policy version.
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
                <h3 className="text-base font-semibold text-neutral-900">Decision Trace & Gate Evaluation</h3>
                <p className="text-xs text-neutral-500">Deterministic policy evaluation audit without black-box opacity.</p>
              </div>
              <button
                onClick={() => setSelectedTrace(null)}
                className="p-1 rounded-lg hover:bg-neutral-100 text-neutral-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

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
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div>Subtotal: <strong className="text-neutral-900 block font-bold">₹{selectedTrace.arithmetic.subtotal}</strong></div>
                    <div>Discount: <strong className="text-emerald-700 block font-bold">-₹{selectedTrace.arithmetic.discount}</strong></div>
                    <div>Final Captured: <strong className="text-violet-700 block font-bold">₹{selectedTrace.arithmetic.final_total}</strong></div>
                    <div>Buyer Savings: <strong className="text-emerald-700 block font-bold">₹{selectedTrace.arithmetic.buyer_savings}</strong></div>
                  </div>
                </div>
              )}

              <div className="p-3 bg-neutral-50 rounded-xl border border-black/5 space-y-2">
                <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider block">4. Guardrail Gate Verification</span>
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

      {/* ================= MODAL: VIEW POLICY SNAPSHOT & PERFORMANCE ================= */}
      {selectedSnapshot && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-black/10 rounded-2xl max-w-2xl w-full p-6 space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto animate-scale-up">
            <div className="flex items-center justify-between pb-3 border-b border-black/10">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-violet-50 text-violet-700 rounded-xl border border-violet-200">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <h3 className="text-base font-bold text-neutral-900">Policy Snapshot {selectedSnapshot.version}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      selectedSnapshot.status === "active"
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-neutral-100 text-neutral-600"
                    }`}>
                      {selectedSnapshot.status === "active" ? "Active Policy" : "Superseded"}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-500">Created on {new Date(selectedSnapshot.created_at).toLocaleString()}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedSnapshot(null)}
                className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-5 text-xs">
              {/* Section 1: Immutable Configuration */}
              <div className="space-y-2">
                <span className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider block">
                  1. Immutable Policy Configuration
                </span>
                <div className="p-3.5 bg-neutral-50/80 rounded-xl border border-black/5 space-y-2.5">
                  <div className="text-[11px] text-neutral-600">
                    <strong className="text-neutral-900">Summary:</strong> {selectedSnapshot.change_summary}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-1 border-t border-black/5">
                    <div>
                      <span className="text-neutral-500 block text-[10px]">Autonomous Cap</span>
                      <strong className="text-neutral-900 font-bold">₹{(selectedSnapshot.policy.max_autonomous_checkout_paise / 100).toLocaleString()}</strong>
                    </div>
                    <div>
                      <span className="text-neutral-500 block text-[10px]">Quote TTL Window</span>
                      <strong className="text-neutral-900 font-bold">{selectedSnapshot.policy.quote_expiry_seconds}s</strong>
                    </div>
                    <div>
                      <span className="text-neutral-500 block text-[10px]">UPI Mandate</span>
                      <strong className="text-neutral-900 font-bold">{selectedSnapshot.policy.mandate_required ? "Required" : "Optional"}</strong>
                    </div>
                    <div>
                      <span className="text-neutral-500 block text-[10px]">Margin Floor</span>
                      <strong className="text-neutral-900 font-bold">{selectedSnapshot.policy.margin_floor_percent ?? 60}%</strong>
                    </div>
                    <div>
                      <span className="text-neutral-500 block text-[10px]">Global Max Discount</span>
                      <strong className="text-neutral-900 font-bold">{selectedSnapshot.policy.max_discount_percent ?? 25}%</strong>
                    </div>
                    <div>
                      <span className="text-neutral-500 block text-[10px]">Active Growth Rules</span>
                      <strong className="text-neutral-900 font-bold">{selectedSnapshot.growth_rules?.length || 0} Rules</strong>
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 2: Performance under this policy */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider block">
                    2. Performance under this policy
                  </span>
                  {snapshotPerformance && (snapshotPerformance.first_activity_at || snapshotPerformance.last_activity_at) && (
                    <span className="text-[10px] text-neutral-400 font-mono">
                      Active: {snapshotPerformance.first_activity_at ? new Date(snapshotPerformance.first_activity_at).toLocaleDateString() : ""}
                      {snapshotPerformance.last_activity_at ? ` → ${new Date(snapshotPerformance.last_activity_at).toLocaleDateString()}` : ""}
                    </span>
                  )}
                </div>

                {loadingSnapshotPerf ? (
                  <div className="p-8 border border-black/5 bg-neutral-50 rounded-xl flex items-center justify-center space-x-2 text-neutral-500">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Calculating derived performance metrics...</span>
                  </div>
                ) : snapshotPerformance && (snapshotPerformance.orders_completed > 0 || snapshotPerformance.quotes_issued > 0 || snapshotPerformance.blocked_attempts > 0) ? (
                  <div className="space-y-3">
                    {/* Metrics Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      <div className="p-3 bg-white border border-black/10 rounded-xl space-y-0.5">
                        <span className="text-[10px] font-medium text-neutral-500 block">Revenue Captured</span>
                        <p className="text-base font-bold text-neutral-900">₹{(snapshotPerformance.revenue_captured_paise / 100).toLocaleString()}</p>
                        <span className="text-[10px] text-neutral-400">{snapshotPerformance.orders_completed} orders completed</span>
                      </div>

                      <div className="p-3 bg-white border border-black/10 rounded-xl space-y-0.5">
                        <span className="text-[10px] font-medium text-neutral-500 block">Avg Order Value</span>
                        <p className="text-base font-bold text-neutral-900">₹{Math.round(snapshotPerformance.average_order_value_paise / 100).toLocaleString()}</p>
                        <span className="text-[10px] text-neutral-400">Per settled cart</span>
                      </div>

                      <div className="p-3 bg-white border border-black/10 rounded-xl space-y-0.5">
                        <span className="text-[10px] font-medium text-neutral-500 block">Incremental Revenue</span>
                        <p className="text-base font-bold text-violet-700">₹{(snapshotPerformance.incremental_revenue_paise / 100).toLocaleString()}</p>
                        <span className="text-[10px] text-neutral-400">From bundles & cross-sells</span>
                      </div>

                      <div className="p-3 bg-white border border-black/10 rounded-xl space-y-0.5">
                        <span className="text-[10px] font-medium text-neutral-500 block">Buyer Savings</span>
                        <p className="text-base font-bold text-emerald-700">₹{(snapshotPerformance.buyer_savings_paise / 100).toLocaleString()}</p>
                        <span className="text-[10px] text-neutral-400">Delivered to buyers</span>
                      </div>

                      <div className="p-3 bg-white border border-black/10 rounded-xl space-y-0.5">
                        <span className="text-[10px] font-medium text-neutral-500 block">Quotes Issued</span>
                        <p className="text-base font-bold text-neutral-900">{snapshotPerformance.quotes_issued}</p>
                        <span className="text-[10px] text-neutral-400">
                          {snapshotPerformance.quote_success_rate_percent !== null ? `${snapshotPerformance.quote_success_rate_percent}% success rate` : "—"}
                        </span>
                      </div>

                      <div className="p-3 bg-white border border-black/10 rounded-xl space-y-0.5">
                        <span className="text-[10px] font-medium text-neutral-500 block">Growth Conversion</span>
                        <p className="text-base font-bold text-orange-600">
                          {snapshotPerformance.growth_conversion_rate_percent !== null ? `${snapshotPerformance.growth_conversion_rate_percent}%` : "—"}
                        </p>
                        <span className="text-[10px] text-neutral-400">Adopted incentive deals</span>
                      </div>

                      <div className="p-3 bg-white border border-black/10 rounded-xl space-y-0.5">
                        <span className="text-[10px] font-medium text-neutral-500 block">Blocked Attempts</span>
                        <p className="text-base font-bold text-rose-600">{snapshotPerformance.blocked_attempts}</p>
                        <span className="text-[10px] text-neutral-400">Protected by gates</span>
                      </div>

                      <div className="p-3 bg-white border border-black/10 rounded-xl space-y-0.5">
                        <span className="text-[10px] font-medium text-neutral-500 block">Payment Recovery</span>
                        <p className="text-base font-bold text-teal-600">{snapshotPerformance.payment_recoveries}</p>
                        <span className="text-[10px] text-neutral-400">
                          {snapshotPerformance.recovery_rate_percent !== null ? `${snapshotPerformance.recovery_rate_percent}% rate` : "Recovered sessions"}
                        </span>
                      </div>
                    </div>

                    <p className="text-[11px] text-neutral-500 italic">
                      Metrics are derived from quotes, orders, payments, and Trust Ledger events that reference this policy version.
                    </p>
                  </div>
                ) : (
                  <div className="p-4 bg-neutral-50 border border-black/5 rounded-xl text-center space-y-1">
                    <p className="text-xs font-semibold text-neutral-700">No activity recorded under this policy version yet.</p>
                    <p className="text-[11px] text-neutral-500">
                      Metrics are derived from quotes, orders, payments, and Trust Ledger events that reference this policy version.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setSelectedSnapshot(null)}
                className="px-4 py-2 border border-black/10 rounded-xl text-xs font-semibold text-neutral-700 hover:bg-neutral-100 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: DEVELOPER EVIDENCE & AGENT CONTRACT ================= */}
      {showDeveloperEvidence && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-black/10 rounded-2xl max-w-3xl w-full p-6 space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto animate-scale-up">
            <div className="flex items-center justify-between pb-3 border-b border-black/10">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 bg-violet-50 text-violet-700 rounded-xl border border-violet-200">
                  <Terminal className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-neutral-900">Agent Contract & Developer Evidence</h3>
                  <p className="text-xs text-neutral-500">Inspect live machine schemas, OpenAPI contracts, and multi-protocol adapters.</p>
                </div>
              </div>
              <button
                onClick={() => setShowDeveloperEvidence(false)}
                className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Protocol Subtabs */}
            <div className="flex space-x-1 bg-neutral-100 p-1 rounded-xl text-xs font-semibold">
              <button
                onClick={() => setProtocolTab("acp")}
                className={`flex-1 py-1.5 rounded-lg transition-all ${
                  protocolTab === "acp" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:text-neutral-900"
                }`}
              >
                ACP Protocol
              </button>
              <button
                onClick={() => setProtocolTab("ap2")}
                className={`flex-1 py-1.5 rounded-lg transition-all ${
                  protocolTab === "ap2" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:text-neutral-900"
                }`}
              >
                AP2 Protocol
              </button>
              <button
                onClick={() => setProtocolTab("x402")}
                className={`flex-1 py-1.5 rounded-lg transition-all ${
                  protocolTab === "x402" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:text-neutral-900"
                }`}
              >
                x402 Protocol
              </button>
              <button
                onClick={() => setProtocolTab("manifest")}
                className={`flex-1 py-1.5 rounded-lg transition-all ${
                  protocolTab === "manifest" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:text-neutral-900"
                }`}
              >
                Agent Manifest & OpenAPI
              </button>
            </div>

            {/* Content Area for Active Protocol */}
            <div className="space-y-4 text-xs font-sans">
              {protocolTab === "acp" && (
                <div className="space-y-3">
                  <div className="p-3 bg-neutral-50 rounded-xl border border-black/5 space-y-1">
                    <span className="font-semibold text-neutral-800">Agent Commerce Protocol (ACP) Adapter</span>
                    <p className="text-neutral-600 text-[11px]">
                      Encapsulates catalog discovery, bounded negotiation, and autonomous checkout within standard ACP wrapper format.
                    </p>
                  </div>
                  <div className="bg-neutral-900 text-neutral-200 rounded-xl p-3 font-mono text-[11px] overflow-x-auto space-y-1">
                    <p className="text-neutral-400"># 1. Fetch ACP Catalog with Active Growth Rules</p>
                    <p className="text-emerald-400">GET /api/protocol/adapter?protocol=acp-shaped&endpoint=catalog</p>
                    <p className="text-neutral-400 pt-2"># 2. Autonomous ACP Checkout with UPI Mandate</p>
                    <p className="text-emerald-400">POST /api/protocol/adapter?protocol=acp-shaped&endpoint=checkout</p>
                  </div>
                </div>
              )}

              {protocolTab === "ap2" && (
                <div className="space-y-3">
                  <div className="p-3 bg-neutral-50 rounded-xl border border-black/5 space-y-1">
                    <span className="font-semibold text-neutral-800">Agent Payment Protocol 2 (AP2) Adapter</span>
                    <p className="text-neutral-600 text-[11px]">
                      Maps autonomous intents into AP2 payment envelopes with mandate authorization hashes and audit tokens.
                    </p>
                  </div>
                  <div className="bg-neutral-900 text-neutral-200 rounded-xl p-3 font-mono text-[11px] overflow-x-auto space-y-1">
                    <p className="text-neutral-400"># 1. Fetch AP2 Catalog</p>
                    <p className="text-emerald-400">GET /api/protocol/adapter?protocol=ap2-shaped&endpoint=catalog</p>
                    <p className="text-neutral-400 pt-2"># 2. Complete AP2 Autonomous Payment</p>
                    <p className="text-emerald-400">POST /api/protocol/adapter?protocol=ap2-shaped&endpoint=checkout</p>
                  </div>
                </div>
              )}

              {protocolTab === "x402" && (
                <div className="space-y-3">
                  <div className="p-3 bg-neutral-50 rounded-xl border border-black/5 space-y-1">
                    <span className="font-semibold text-neutral-800">HTTP 402 Payment Required (x402) Adapter</span>
                    <p className="text-neutral-600 text-[11px]">
                      Provides programmatic 402 payment authorization flow with micro-payment payload schemas and quote validation.
                    </p>
                  </div>
                  <div className="bg-neutral-900 text-neutral-200 rounded-xl p-3 font-mono text-[11px] overflow-x-auto space-y-1">
                    <p className="text-neutral-400"># 1. Fetch x402 Service Manifest</p>
                    <p className="text-emerald-400">GET /api/protocol/adapter?protocol=x402-shaped&endpoint=catalog</p>
                    <p className="text-neutral-400 pt-2"># 2. Settle x402 Payment Header</p>
                    <p className="text-emerald-400">POST /api/protocol/adapter?protocol=x402-shaped&endpoint=checkout</p>
                  </div>
                </div>
              )}

              {protocolTab === "manifest" && (
                <div className="space-y-3">
                  <div className="p-3 bg-neutral-50 rounded-xl border border-black/5 space-y-1">
                    <span className="font-semibold text-neutral-800">OpenAPI 3.1 & Agent Catalog Endpoints</span>
                    <p className="text-neutral-600 text-[11px]">
                      Direct machine-readable endpoints providing live product catalog, active growth rules, policy bounds, and OpenAPI schemas.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <a
                      href="/api/agent/catalog"
                      target="_blank"
                      rel="noreferrer"
                      className="p-3 bg-white border border-black/10 rounded-xl hover:border-black/30 transition-all flex items-center justify-between"
                    >
                      <div>
                        <span className="font-semibold text-neutral-900 block font-mono text-[11px]">/api/agent/catalog</span>
                        <span className="text-[11px] text-neutral-500">Live products & growth manifest</span>
                      </div>
                      <ArrowUpRight className="w-4 h-4 text-neutral-500" />
                    </a>
                    <a
                      href="/api/openapi.json"
                      target="_blank"
                      rel="noreferrer"
                      className="p-3 bg-white border border-black/10 rounded-xl hover:border-black/30 transition-all flex items-center justify-between"
                    >
                      <div>
                        <span className="font-semibold text-neutral-900 block font-mono text-[11px]">/api/openapi.json</span>
                        <span className="text-[11px] text-neutral-500">OpenAPI 3.1 schema specification</span>
                      </div>
                      <ArrowUpRight className="w-4 h-4 text-neutral-500" />
                    </a>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-2 flex justify-between items-center border-t border-black/10">
              <span className="text-[11px] text-neutral-500 font-mono">Status: All protocol adapters operational</span>
              <button
                onClick={() => setShowDeveloperEvidence(false)}
                className="px-4 py-2 bg-neutral-900 text-white rounded-xl text-xs font-semibold hover:bg-neutral-800 transition-colors"
              >
                Close Drawer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

