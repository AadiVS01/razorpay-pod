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

  useEffect(() => {
    fetchCatalog();
  }, [selectedCategory, inStockOnly, maxPrice, searchQuery]);

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
      <div className="bg-foreground text-background px-4 py-3 border-b border-foreground flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-2.5">
          <div className="w-7 h-7 bg-background text-foreground flex items-center justify-center font-mono font-black text-xs">
            <Terminal className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-mono text-xs font-black uppercase tracking-widest text-background">
                A2A Machine Catalog Inspector
              </span>
              <span className="px-1.5 py-0.2 text-[9px] font-mono font-bold bg-emerald-500 text-black uppercase">
                a2a-v1.0
              </span>
            </div>
            <p className="text-[10px] text-background/80 font-mono">
              Deterministic endpoint for Autonomous AI Buyer Agents
            </p>
          </div>
        </div>

        {/* Live Metrics */}
        <div className="flex items-center space-x-2 text-xs font-mono">
          <div className="flex items-center space-x-1 px-2 py-0.5 bg-background/20 text-background">
            <Zap className="w-3 h-3 text-amber-400" />
            <span className="text-[11px] font-bold">{latency}ms</span>
          </div>

          <button
            onClick={fetchCatalog}
            disabled={loading}
            className="flex items-center space-x-1 px-2 py-0.5 bg-background text-foreground hover:opacity-80 text-xs font-bold uppercase transition-opacity disabled:opacity-50"
            title="Refresh Endpoint"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline text-[10px]">Fetch</span>
          </button>
        </div>
      </div>

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

    </div>
  );
};
