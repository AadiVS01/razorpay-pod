"use client";

import React, { useState, useEffect } from "react";
import { Shield, Sparkles, Check, RefreshCw, AlertTriangle, ToggleLeft, ToggleRight, DollarSign, Eye, EyeOff } from "lucide-react";
import { MerchantConfig, MerchantPolicy, BundleRule, ProductOverride } from "@/lib/merchant-config";

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

export const MerchantControlCenter: React.FC = () => {
  const [config, setConfig] = useState<MerchantConfig | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Stats
  const [todayRevenue, setTodayRevenue] = useState(0);
  const [todayOrders, setTodayOrders] = useState(0);
  const [ledgerEvents, setLedgerEvents] = useState<any[]>([]);

  // Fetch current configs and products
  const loadConfigAndProducts = async () => {
    setLoading(true);
    try {
      // 1. Load Policies, overrides, and bundles
      const configRes = await fetch("/api/merchant/config");
      const configData = await configRes.json();
      
      // 2. Load live products from catalog to get authoritative stock/price
      const catalogRes = await fetch("/api/agent/catalog");
      const catalogData = await catalogRes.json();

      if (configData.status === "success" && catalogData.status === "success") {
        setConfig(configData.config);
        
        // Merge catalog properties with merchant config overrides
        const mergedProducts: ProductRow[] = catalogData.products.map((p: any) => {
          const override = configData.config.product_overrides[p.id] || { negotiable: true, max_discount_percent: 10 };
          return {
            id: p.id,
            name: p.name,
            price_paise: p.price_paise,
            stock: p.stock,
            active: p.in_stock !== false, // active if returned in catalog
            category: p.category,
            negotiable: override.negotiable,
            max_discount_percent: override.max_discount_percent,
            sizes: p.sizes || [],
            colors: p.colors || []
          };
        });
        setProducts(mergedProducts);
      }
      
      // 3. Query simulated ledger to compute today's revenue stats
      const ledgerRes = await fetch("/api/agent/ledger");
      const ledgerData = await ledgerRes.json();
      if (ledgerData.status === "success" && ledgerData.events) {
        const completed = ledgerData.events.filter((e: any) => e.outcome === "COMPLETED");
        const rev = completed.reduce((acc: number, cur: any) => acc + (cur.amount_after || 0), 0);
        setTodayRevenue(rev);
        setTodayOrders(completed.length);
        setLedgerEvents(ledgerData.events);
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
    const overrides = { ...config.product_overrides };
    const current = overrides[productId] || { negotiable: true, max_discount_percent: 10 };
    overrides[productId] = {
      ...current,
      [field]: value
    };
    setConfig({
      ...config,
      product_overrides: overrides
    });
  };

  const handleUpdateBundle = (field: keyof BundleRule, value: any) => {
    if (!config || config.bundle_rules.length === 0) return;
    const updatedBundles = [...config.bundle_rules];
    updatedBundles[0] = {
      ...updatedBundles[0],
      [field]: value
    };
    setConfig({
      ...config,
      bundle_rules: updatedBundles
    });
  };

  const handleProductLocalChange = (productId: string, field: keyof ProductRow, value: any) => {
    setProducts(products.map(p => p.id === productId ? { ...p, [field]: value } : p));
  };

  const handleSaveAll = async () => {
    if (!config) return;
    setSaving(true);
    setMessage(null);
    setErrorMsg(null);
    try {
      const payload = {
        config,
        products: products.map(p => ({
          id: p.id,
          name: p.name,
          price_paise: p.price_paise,
          stock: p.stock,
          active: p.active,
          category: p.category,
          sizes: p.sizes,
          colors: p.colors
        }))
      };

      const res = await fetch("/api/merchant/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      
      if (res.status === 200 && data.status === "success") {
        setMessage("Configuration and DB products updated successfully!");
        setTimeout(() => setMessage(null), 3000);
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

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-foreground font-mono text-xs">
        <RefreshCw className="w-8 h-8 animate-spin mb-4" />
        <span>Syncing Merchant Control boundaries...</span>
      </div>
    );
  }

  const activeProducts = products.filter(p => p.active).length;
  const stockWarnings = products.filter(p => p.stock <= 5).length;
  const bundle = config?.bundle_rules[0];

  return (
    <div className="space-y-6 font-mono text-xs text-foreground">
      
      {/* Top Header stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-background border-2 border-foreground p-4 shadow-md">
          <span className="text-[10px] text-muted-foreground uppercase font-bold">Store Status</span>
          <div className="flex items-center space-x-2 mt-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-sm font-black uppercase">Store Live</span>
          </div>
        </div>
        <div className="bg-background border-2 border-foreground p-4 shadow-md col-span-1">
          <span className="text-[10px] text-muted-foreground uppercase font-bold">Active Products</span>
          <p className="text-xl font-black mt-1">{activeProducts} / {products.length}</p>
        </div>
        <div className="bg-background border-2 border-foreground p-4 shadow-md col-span-1">
          <span className="text-[10px] text-muted-foreground uppercase font-bold">Stock Warnings</span>
          <div className="flex items-center space-x-2 mt-1">
            {stockWarnings > 0 && <AlertTriangle className="w-4 h-4 text-amber-500" />}
            <p className="text-xl font-black">{stockWarnings} Items Low</p>
          </div>
        </div>
        <div className="bg-background border-2 border-foreground p-4 shadow-md col-span-1">
          <span className="text-[10px] text-muted-foreground uppercase font-bold">Today's Revenue</span>
          <p className="text-xl font-black mt-1">₹{todayRevenue} ({todayOrders} orders)</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Side: Product Configuration */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Product list table */}
          <div className="bg-background border-2 border-foreground p-4 shadow-md space-y-3">
            <h2 className="text-sm font-black uppercase tracking-wider border-b border-foreground pb-2 flex items-center justify-between">
              <span>Authoritative Catalog Products</span>
              <span className="text-[10px] text-muted-foreground">(Supabase Database Schema)</span>
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse border border-foreground">
                <thead>
                  <tr className="bg-muted/40 uppercase tracking-widest text-[9px] border-b border-foreground font-black">
                    <th className="p-2 border-r border-foreground">Name</th>
                    <th className="p-2 border-r border-foreground">Category</th>
                    <th className="p-2 border-r border-foreground">Base Price</th>
                    <th className="p-2 border-r border-foreground">Stock</th>
                    <th className="p-2 border-r border-foreground">Sizes</th>
                    <th className="p-2 border-r border-foreground">Colors</th>
                    <th className="p-2 border-r border-foreground">Negotiable</th>
                    <th className="p-2 border-r border-foreground">Max Discount</th>
                    <th className="p-2">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id} className="border-b border-foreground hover:bg-muted/10 transition-colors">
                      <td className="p-2 border-r border-foreground">
                        <input
                          type="text"
                          value={p.name}
                          onChange={(e) => handleProductLocalChange(p.id, "name", e.target.value)}
                          className="w-full bg-background border border-border px-1 py-0.5 font-bold focus:outline-none"
                        />
                      </td>
                      <td className="p-2 border-r border-foreground">
                        <input
                          type="text"
                          value={p.category}
                          onChange={(e) => handleProductLocalChange(p.id, "category", e.target.value)}
                          className="w-full bg-background border border-border px-1 py-0.5 font-bold focus:outline-none"
                        />
                      </td>
                      <td className="p-2 border-r border-foreground font-mono">
                        <input
                          type="number"
                          value={Math.round(p.price_paise / 100)}
                          onChange={(e) => handleProductLocalChange(p.id, "price_paise", parseInt(e.target.value || "0") * 100)}
                          className="w-16 bg-background border border-border px-1 py-0.5 font-bold focus:outline-none"
                        />
                      </td>
                      <td className="p-2 border-r border-foreground font-mono">
                        <input
                          type="number"
                          value={p.stock}
                          onChange={(e) => handleProductLocalChange(p.id, "stock", parseInt(e.target.value || "0"))}
                          className="w-12 bg-background border border-border px-1 py-0.5 font-bold focus:outline-none"
                        />
                      </td>
                      <td className="p-2 border-r border-foreground">
                        <input
                          type="text"
                          value={p.sizes.join(", ")}
                          onChange={(e) => handleProductLocalChange(p.id, "sizes", e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
                          className="w-full bg-background border border-border px-1 py-0.5 font-mono focus:outline-none"
                        />
                      </td>
                      <td className="p-2 border-r border-foreground">
                        <input
                          type="text"
                          value={p.colors.join(", ")}
                          onChange={(e) => handleProductLocalChange(p.id, "colors", e.target.value.split(",").map(c => c.trim()).filter(Boolean))}
                          className="w-full bg-background border border-border px-1 py-0.5 font-mono focus:outline-none"
                        />
                      </td>
                      <td className="p-2 border-r border-foreground text-center">
                        <button
                          onClick={() => handleUpdateOverride(p.id, "negotiable", !p.negotiable)}
                          className="focus:outline-none"
                        >
                          {p.negotiable ? (
                            <span className="px-1.5 py-0.5 bg-emerald-500 text-black text-[9px] font-bold">YES</span>
                          ) : (
                            <span className="px-1.5 py-0.5 bg-muted text-foreground text-[9px] font-bold">NO</span>
                          )}
                        </button>
                      </td>
                      <td className="p-2 border-r border-foreground font-mono">
                        <input
                          type="number"
                          disabled={!p.negotiable}
                          value={p.max_discount_percent}
                          onChange={(e) => handleUpdateOverride(p.id, "max_discount_percent", parseInt(e.target.value || "0"))}
                          className="w-10 bg-background border border-border px-1 py-0.5 font-bold focus:outline-none disabled:opacity-50"
                        />%
                      </td>
                      <td className="p-2">
                        <button
                          onClick={() => handleProductLocalChange(p.id, "active", !p.active)}
                          className="focus:outline-none"
                        >
                          {p.active ? (
                            <span className="px-1.5 py-0.5 bg-foreground text-background text-[9px] font-bold">ACTIVE</span>
                          ) : (
                            <span className="px-1.5 py-0.5 bg-rose-500 text-white text-[9px] font-bold">INACTIVE</span>
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bundle Rules Configuration */}
          <div className="bg-background border-2 border-foreground p-4 shadow-md space-y-4">
            <h2 className="text-sm font-black uppercase tracking-wider border-b border-foreground pb-2">
              Outfit Bundle Rules & Revenue Preview
            </h2>
            {bundle ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div>
                    <label className="block text-[9px] uppercase font-bold text-muted-foreground mb-1">Bundle Name</label>
                    <input
                      type="text"
                      value={bundle.name}
                      onChange={(e) => handleUpdateBundle("name", e.target.value)}
                      className="w-full bg-background border border-foreground p-2 font-bold focus:outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[9px] uppercase font-bold text-muted-foreground mb-1">Discount %</label>
                      <input
                        type="number"
                        value={bundle.discount_percent}
                        onChange={(e) => handleUpdateBundle("discount_percent", parseInt(e.target.value || "0"))}
                        className="w-full bg-background border border-foreground p-2 font-bold focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] uppercase font-bold text-muted-foreground mb-1">Status</label>
                      <button
                        onClick={() => handleUpdateBundle("active", !bundle.active)}
                        className="w-full border-2 border-foreground py-2 font-bold text-[10px] uppercase hover:bg-muted/10"
                      >
                        {bundle.active ? "Enabled" : "Disabled"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Bundle Economics Preview */}
                <div className="border border-dashed border-foreground p-3 bg-muted/20 flex flex-col justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Economics Preview</span>
                  <div className="space-y-1 font-mono text-[11px] mt-2">
                    <div className="flex justify-between">
                      <span>Individual Total:</span>
                      <span className="font-bold">₹1,198</span>
                    </div>
                    <div className="flex justify-between border-b border-border pb-1">
                      <span>Bundle Total ({bundle.discount_percent}%):</span>
                      <span className="font-bold">₹1,018</span>
                    </div>
                    <div className="flex justify-between text-emerald-600 font-bold">
                      <span>Buyer Savings:</span>
                      <span>₹180</span>
                    </div>
                    <div className="flex justify-between text-indigo-600 font-black">
                      <span>Merchant Revenue:</span>
                      <span>₹1,018</span>
                    </div>
                  </div>
                  <p className="text-[9px] text-muted-foreground leading-tight mt-2 uppercase">
                    Promotes larger basket size. Generates +₹369 incremental revenue compared to single shirt checkout.
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">No bundle rule loaded.</p>
            )}
          </div>
        </div>

        {/* Right Side: Global Agent Policies & Config Transmission */}
        <div className="space-y-6">
          
          {/* Agent policy switches */}
          <div className="bg-background border-2 border-foreground p-4 shadow-md space-y-4">
            <h2 className="text-sm font-black uppercase tracking-wider border-b border-foreground pb-2 flex items-center justify-between">
              <span>Agent Policy Boundaries</span>
              <Shield className="w-4 h-4" />
            </h2>
            {config ? (
              <div className="space-y-4">
                
                {/* Switches */}
                <div className="space-y-3">
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold uppercase tracking-wider text-[10px]">Bundle Recommendations</p>
                      <p className="text-[9px] text-muted-foreground">Recommend matching accessories</p>
                    </div>
                    <button
                      onClick={() => handleUpdatePolicy("agent_can_recommend_bundles", !config.policy.agent_can_recommend_bundles)}
                      className="focus:outline-none"
                    >
                      {config.policy.agent_can_recommend_bundles ? (
                        <ToggleRight className="w-7 h-7 text-foreground" />
                      ) : (
                        <ToggleLeft className="w-7 h-7 text-muted-foreground" />
                      )}
                    </button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold uppercase tracking-wider text-[10px]">Agent Negotiation Bids</p>
                      <p className="text-[9px] text-muted-foreground">Agrees to dynamic bid floors</p>
                    </div>
                    <button
                      onClick={() => handleUpdatePolicy("agent_can_negotiate", !config.policy.agent_can_negotiate)}
                      className="focus:outline-none"
                    >
                      {config.policy.agent_can_negotiate ? (
                        <ToggleRight className="w-7 h-7 text-foreground" />
                      ) : (
                        <ToggleLeft className="w-7 h-7 text-muted-foreground" />
                      )}
                    </button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold uppercase tracking-wider text-[10px]">Autonomous Checkout</p>
                      <p className="text-[9px] text-muted-foreground">Agent may trigger payment links</p>
                    </div>
                    <button
                      onClick={() => handleUpdatePolicy("agent_can_checkout", !config.policy.agent_can_checkout)}
                      className="focus:outline-none"
                    >
                      {config.policy.agent_can_checkout ? (
                        <ToggleRight className="w-7 h-7 text-foreground" />
                      ) : (
                        <ToggleLeft className="w-7 h-7 text-muted-foreground" />
                      )}
                    </button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold uppercase tracking-wider text-[10px]">Mandate Consent Required</p>
                      <p className="text-[9px] text-muted-foreground">UPI mandating pre-auth check</p>
                    </div>
                    <button
                      onClick={() => handleUpdatePolicy("mandate_required", !config.policy.mandate_required)}
                      className="focus:outline-none"
                    >
                      {config.policy.mandate_required ? (
                        <ToggleRight className="w-7 h-7 text-foreground" />
                      ) : (
                        <ToggleLeft className="w-7 h-7 text-muted-foreground" />
                      )}
                    </button>
                  </div>

                </div>

                {/* Policy inputs */}
                <div className="border-t border-foreground pt-3 space-y-3">
                  <div>
                    <label className="block text-[9px] uppercase font-bold text-muted-foreground mb-1">
                      Max Autonomous Checkout Cap (INR)
                    </label>
                    <input
                      type="number"
                      value={config.policy.max_autonomous_checkout_paise / 100}
                      onChange={(e) => handleUpdatePolicy("max_autonomous_checkout_paise", parseInt(e.target.value || "0") * 100)}
                      className="w-full bg-background border border-foreground p-2 font-bold focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] uppercase font-bold text-muted-foreground mb-1">
                      Quote Expiry Window (Seconds)
                    </label>
                    <input
                      type="number"
                      value={config.policy.quote_expiry_seconds}
                      onChange={(e) => handleUpdatePolicy("quote_expiry_seconds", parseInt(e.target.value || "0"))}
                      className="w-full bg-background border border-foreground p-2 font-bold focus:outline-none"
                    />
                  </div>
                </div>

              </div>
            ) : null}
          </div>

          {/* Action buttons */}
          <div className="space-y-2">
            <button
              onClick={handleSaveAll}
              disabled={saving}
              className="w-full bg-foreground text-background font-black border-2 border-foreground py-3 uppercase tracking-widest text-center flex items-center justify-center space-x-2 hover:opacity-85 transition-opacity disabled:opacity-50 shadow-md"
            >
              {saving ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Syncing Rules...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>Transmit Policy Changes</span>
                </>
              )}
            </button>
            {message && (
              <div className="p-2 border border-emerald-600 bg-emerald-500/10 text-emerald-600 text-center font-bold">
                {message}
              </div>
            )}
            {errorMsg && (
              <div className="p-2 border border-rose-600 bg-rose-500/10 text-rose-600 text-center font-bold">
                {errorMsg}
              </div>
            )}
          </div>

        </div>

      </div>

      {/* Trust Ledger Audit Trail */}
      <div className="bg-background border-2 border-foreground p-4 shadow-md space-y-4">
        <h2 className="text-sm font-black uppercase tracking-wider border-b border-foreground pb-2 flex items-center justify-between">
          <span>Durable Trust Ledger Audit Logs</span>
          <span className="text-[10px] text-muted-foreground">Authoritative Transaction History</span>
        </h2>
        {ledgerEvents.length === 0 ? (
          <p className="text-muted-foreground py-2">No transaction events recorded in ledger.</p>
        ) : (
          <div className="overflow-x-auto border border-foreground">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-muted/40 uppercase tracking-wider text-[9px] border-b border-foreground font-black">
                  <th className="p-2 border-r border-foreground">Timestamp</th>
                  <th className="p-2 border-r border-foreground">Actor</th>
                  <th className="p-2 border-r border-foreground">Action</th>
                  <th className="p-2 border-r border-foreground">Quote ID</th>
                  <th className="p-2 border-r border-foreground">Order ID</th>
                  <th className="p-2 border-r border-foreground">Before</th>
                  <th className="p-2 border-r border-foreground">After</th>
                  <th className="p-2 border-r border-foreground">Policy</th>
                  <th className="p-2 border-r border-foreground">Reason</th>
                  <th className="p-2">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {ledgerEvents.slice().reverse().map((e, idx) => (
                  <tr key={idx} className="border-b border-foreground hover:bg-muted/20 transition-colors">
                    <td className="p-2 border-r border-foreground text-[10px] whitespace-nowrap">
                      {new Date(e.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="p-2 border-r border-foreground font-bold text-[10px] whitespace-nowrap">
                      {e.actor}
                    </td>
                    <td className="p-2 border-r border-foreground whitespace-nowrap">
                      <span className="px-1.5 py-0.5 bg-foreground text-background font-black text-[9px] uppercase tracking-wider">
                        {e.action}
                      </span>
                    </td>
                    <td className="p-2 border-r border-foreground max-w-[80px] truncate text-[10px] text-muted-foreground" title={e.quote_id}>
                      {e.quote_id || "-"}
                    </td>
                    <td className="p-2 border-r border-foreground font-bold max-w-[80px] truncate text-[10px]" title={e.order_id}>
                      {e.order_id || "-"}
                    </td>
                    <td className="p-2 border-r border-foreground font-bold text-muted-foreground text-[10px]">
                      {e.amount_before ? `₹${e.amount_before}` : "-"}
                    </td>
                    <td className="p-2 border-r border-foreground font-bold text-[10px]">
                      {e.amount_after ? `₹${e.amount_after}` : "-"}
                    </td>
                    <td className="p-2 border-r border-foreground">
                      <span className={`px-1.5 py-0.5 text-[9px] font-black uppercase ${
                        e.policy_result === "ALLOWED" ? "bg-emerald-500 text-black border border-emerald-600" : "bg-rose-500 text-white border border-rose-600"
                      }`}>
                        {e.policy_result}
                      </span>
                    </td>
                    <td className="p-2 border-r border-foreground text-[10px] text-muted-foreground">
                      {e.reason_code || "-"}
                    </td>
                    <td className="p-2 font-black text-[10px]">
                      <span className={
                        e.outcome === "COMPLETED" ? "text-emerald-600" : e.outcome === "RECOVERABLE" ? "text-amber-600" : "text-rose-600"
                      }>
                        {e.outcome}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
};
