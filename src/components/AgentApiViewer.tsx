"use client";

import React, { useState, useEffect } from "react";
import { AgentCatalogResponse } from "@/types/catalog";
import { Copy, Check, Terminal, RefreshCw, Zap, ExternalLink } from "lucide-react";

interface AgentApiViewerProps {
  initialData?: AgentCatalogResponse;
  selectedCategory?: string;
  onCategoryChange?: (category: string) => void;
  maxPrice?: number;
  onMaxPriceChange?: (price: number | undefined) => void;
  inStockOnly?: boolean;
  onInStockOnlyChange?: (inStock: boolean) => void;
  searchQuery?: string;
  onSearchQueryChange?: (q: string) => void;
}

export const AgentApiViewer: React.FC<AgentApiViewerProps> = ({
  initialData,
  selectedCategory = "All",
  onCategoryChange,
  maxPrice,
  onMaxPriceChange,
  inStockOnly = false,
  onInStockOnlyChange,
  searchQuery = "",
  onSearchQueryChange,
}) => {
  const [data, setData] = useState<AgentCatalogResponse | null>(initialData || null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [latency, setLatency] = useState<number>(32);
  const [activeTab, setActiveTab] = useState<"json" | "curl" | "python" | "node">("json");
  const [activeViewer, setActiveViewer] = useState<"catalog" | "ledger">("catalog");
  const [ledgerEvents, setLedgerEvents] = useState<any[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  // Construct query string
  const queryParams = new URLSearchParams();
  if (selectedCategory && selectedCategory !== "All") queryParams.set("category", selectedCategory);
  if (inStockOnly) queryParams.set("in_stock", "true");
  if (maxPrice && maxPrice > 0) queryParams.set("max_price", maxPrice.toString());
  if (searchQuery && searchQuery.trim()) queryParams.set("q", searchQuery.trim());

  const queryString = queryParams.toString();
  const endpointUrl = `/api/agent/catalog${queryString ? `?${queryString}` : ""}`;
  const fullUrl = typeof window !== "undefined" ? `${window.location.origin}${endpointUrl}` : endpointUrl;

  const fetchCatalog = async () => {
    setLoading(true);
    const start = performance.now();
    try {
      const res = await fetch(endpointUrl);
      const json = await res.json();
      const end = performance.now();
      setLatency(Math.round(end - start));
      setData(json);
    } catch (err) {
      console.error("Failed to query catalog API:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchLedger = async () => {
    setLedgerLoading(true);
    try {
      const res = await fetch("/api/agent/ledger");
      const json = await res.json();
      if (json.status === "success" && json.events) {
        setLedgerEvents(json.events);
      }
    } catch (err) {
      console.error("Failed to query ledger API:", err);
    } finally {
      setLedgerLoading(false);
    }
  };

  useEffect(() => {
    fetchCatalog();
  }, [selectedCategory, inStockOnly, maxPrice, searchQuery]);

  useEffect(() => {
    if (activeViewer === "ledger") {
      fetchLedger();
    }
  }, [activeViewer]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const curlSnippet = `curl -X GET "${fullUrl}" \\
  -H "Accept: application/json" \\
  -H "X-Agent-ID: ai-buyer-bot-v1"`;

  const pythonSnippet = `import requests

url = "${fullUrl}"
headers = {
    "Accept": "application/json",
    "X-Agent-ID": "ai-buyer-bot-v1"
}

response = requests.get(url, headers=headers)
catalog = response.json()

print(f"Discovered {catalog['total_items']} items in store:")
for item in catalog['products']:
    print(f"- {item['sku']}: {item['name']} | ₹{item['price_inr']} (Stock: {item['stock']})")`;

  const nodeSnippet = `const res = await fetch("${fullUrl}", {
  headers: {
    "Accept": "application/json",
    "X-Agent-ID": "ai-buyer-bot-v1"
  }
});
const catalog = await res.json();
console.log(\`Found \${catalog.total_items} products:\`, catalog.products);`;

  const categories = ["All", "T-Shirts", "Anime", "Hoodies", "Jackets", "Accessories"];

  return (
    <div className="bg-background text-foreground border-2 border-foreground shadow-xl overflow-hidden flex flex-col h-full">
      
      {/* Top Header Bar */}
      <div className="bg-foreground text-background px-4 py-3 border-b border-foreground flex flex-wrap items-center justify-between gap-3 font-mono">
        <div className="flex items-center space-x-2.5">
          <div className="w-7 h-7 bg-background text-foreground flex items-center justify-center font-mono font-black text-xs">
            <Terminal className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-mono text-xs font-black uppercase tracking-widest text-background">
                {activeViewer === "catalog" ? "A2A Machine Catalog Inspector" : "Razorpay Trust Ledger"}
              </span>
              <span className="px-1.5 py-0.2 text-[9px] font-mono font-bold bg-emerald-500 text-black uppercase">
                a2a-v1.0
              </span>
            </div>
            <p className="text-[10px] text-background/80 font-mono">
              {activeViewer === "catalog" 
                ? "Deterministic endpoint for Autonomous AI Buyer Agents" 
                : "Auditable telemetry ledger recording all financial and policy decisions"}
            </p>
          </div>
        </div>

        {/* View Mode & Live Metrics */}
        <div className="flex items-center space-x-2 text-xs font-mono">
          <div className="flex bg-background/10 border border-background/20 p-0.5">
            <button
              onClick={() => setActiveViewer("catalog")}
              className={`px-2 py-0.5 text-[10px] font-bold uppercase transition-colors ${
                activeViewer === "catalog" ? "bg-background text-foreground" : "text-background hover:bg-background/10"
              }`}
            >
              Catalog
            </button>
            <button
              onClick={() => setActiveViewer("ledger")}
              className={`px-2 py-0.5 text-[10px] font-bold uppercase transition-colors ${
                activeViewer === "ledger" ? "bg-background text-foreground" : "text-background hover:bg-background/10"
              }`}
            >
              Trust Ledger
            </button>
          </div>

          {activeViewer === "catalog" && (
            <div className="flex items-center space-x-1 px-2 py-0.5 bg-background/20 text-background">
              <Zap className="w-3 h-3 text-amber-400" />
              <span className="text-[11px] font-bold">{latency}ms</span>
            </div>
          )}

          <button
            onClick={activeViewer === "catalog" ? fetchCatalog : fetchLedger}
            disabled={loading || ledgerLoading}
            className="flex items-center space-x-1 px-2 py-0.5 bg-background text-foreground hover:opacity-80 text-xs font-bold uppercase transition-opacity disabled:opacity-50"
            title="Refresh Endpoint"
          >
            <RefreshCw className={`w-3 h-3 ${(loading || ledgerLoading) ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline text-[10px]">Fetch</span>
          </button>
        </div>
      </div>

      {activeViewer === "catalog" ? (
        <>
          {/* Endpoint URL Pill */}
          <div className="bg-muted/40 px-4 py-2 border-b border-border flex items-center justify-between text-xs font-mono">
            <div className="flex items-center space-x-2 overflow-x-auto py-0.5 scrollbar-none">
              <span className="px-1.5 py-0.5 bg-foreground text-background font-black text-[10px]">
                GET
              </span>
              <span className="text-foreground font-bold tracking-tight">{endpointUrl}</span>
            </div>

            <a
              href={endpointUrl}
              target="_blank"
              rel="noreferrer"
              className="text-foreground hover:opacity-70 ml-2 shrink-0 flex items-center space-x-1"
              title="Open in new tab"
            >
              <span className="hidden sm:inline text-[10px] font-bold uppercase">Raw</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* Interactive Controls & Filters */}
          <div className="p-3 bg-muted/20 border-b border-border grid grid-cols-1 sm:grid-cols-12 gap-2 text-xs">
            
            {/* Category Filter */}
            <div className="sm:col-span-4">
              <label className="block text-[10px] font-mono uppercase font-bold text-muted-foreground mb-1">
                Category (?category=)
              </label>
              <select
                value={selectedCategory}
                onChange={(e) => onCategoryChange && onCategoryChange(e.target.value)}
                className="w-full bg-background border border-border px-2 py-1 text-foreground text-xs font-mono font-bold uppercase focus:outline-none focus:border-foreground"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* Max Budget Filter */}
            <div className="sm:col-span-4">
              <label className="block text-[10px] font-mono uppercase font-bold text-muted-foreground mb-1">
                Budget Cap INR (?max_price=)
              </label>
              <input
                type="number"
                placeholder="e.g. 1000"
                value={maxPrice || ""}
                onChange={(e) => {
                  const val = e.target.value ? parseFloat(e.target.value) : undefined;
                  onMaxPriceChange && onMaxPriceChange(val);
                }}
                className="w-full bg-background border border-border px-2 py-1 text-foreground text-xs font-mono font-bold uppercase focus:outline-none focus:border-foreground"
              />
            </div>

            {/* Search */}
            <div className="sm:col-span-4">
              <label className="block text-[10px] font-mono uppercase font-bold text-muted-foreground mb-1">
                Search (?q=)
              </label>
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => onSearchQueryChange && onSearchQueryChange(e.target.value)}
                className="w-full bg-background border border-border px-2 py-1 text-foreground text-xs font-mono font-bold uppercase focus:outline-none focus:border-foreground"
              />
            </div>
          </div>

          {/* Code / Payload Switcher Tabs */}
          <div className="bg-muted/40 px-3 py-1.5 border-b border-border flex items-center justify-between">
            <div className="flex space-x-1">
              <button
                onClick={() => setActiveTab("json")}
                className={`px-2.5 py-1 text-[11px] font-mono font-bold uppercase transition-colors ${
                  activeTab === "json"
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                JSON ({data?.total_items ?? 0} items)
              </button>
              <button
                onClick={() => setActiveTab("curl")}
                className={`px-2.5 py-1 text-[11px] font-mono font-bold uppercase transition-colors ${
                  activeTab === "curl"
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                cURL
              </button>
              <button
                onClick={() => setActiveTab("python")}
                className={`px-2.5 py-1 text-[11px] font-mono font-bold uppercase transition-colors ${
                  activeTab === "python"
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Python
              </button>
              <button
                onClick={() => setActiveTab("node")}
                className={`px-2.5 py-1 text-[11px] font-mono font-bold uppercase transition-colors ${
                  activeTab === "node"
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Node.js
              </button>
            </div>

            <button
              onClick={() => {
                if (activeTab === "json") handleCopy(JSON.stringify(data, null, 2));
                if (activeTab === "curl") handleCopy(curlSnippet);
                if (activeTab === "python") handleCopy(pythonSnippet);
                if (activeTab === "node") handleCopy(nodeSnippet);
              }}
              className="flex items-center space-x-1 text-[11px] font-mono font-bold uppercase text-foreground hover:opacity-70 px-2 py-0.5 border border-border transition-opacity"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-emerald-600" />
                  <span className="text-emerald-600">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>

          {/* Code / Content Area */}
          <div className="flex-1 p-4 overflow-auto font-mono text-xs max-h-[480px] bg-background text-foreground">
            {activeTab === "json" && (
              <pre className="whitespace-pre-wrap leading-relaxed">
                {JSON.stringify(data, null, 2)}
              </pre>
            )}

            {activeTab === "curl" && (
              <pre className="whitespace-pre-wrap leading-relaxed">
                {curlSnippet}
              </pre>
            )}

            {activeTab === "python" && (
              <pre className="whitespace-pre-wrap leading-relaxed">
                {pythonSnippet}
              </pre>
            )}

            {activeTab === "node" && (
              <pre className="whitespace-pre-wrap leading-relaxed">
                {nodeSnippet}
              </pre>
            )}
          </div>
        </>
      ) : (
        /* ================= TRUST LEDGER TABLE MODE ================= */
        <div className="flex-1 p-4 overflow-auto font-mono text-xs max-h-[580px] bg-background text-foreground">
          {ledgerLoading ? (
            <p className="text-muted-foreground animate-pulse p-4">Loading audit ledger events...</p>
          ) : ledgerEvents.length === 0 ? (
            <p className="text-muted-foreground p-4">No events recorded in the trust ledger yet.</p>
          ) : (
            <div className="overflow-x-auto border-2 border-foreground">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-foreground text-background uppercase tracking-wider text-[9px] border-b-2 border-foreground font-black">
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
      )}

    </div>
  );
};
