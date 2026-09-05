"use client";

import React, { useState } from "react";
import { Product, AgentProductItem } from "@/types/catalog";
import { ProductCard } from "./ProductCard";
import { Search, X, Bot, Loader2 } from "lucide-react";

interface StorefrontViewProps {
  products: Product[];
  loading?: boolean;
  selectedCategory: string;
  onCategoryChange: (category: string) => void;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  maxPrice?: number;
  onMaxPriceChange: (price: number | undefined) => void;
  inStockOnly: boolean;
  onInStockOnlyChange: (inStock: boolean) => void;
}

export const StorefrontView: React.FC<StorefrontViewProps> = ({
  products,
  loading = false,
  selectedCategory,
  onCategoryChange,
  searchQuery,
  onSearchQueryChange,
  maxPrice,
  onMaxPriceChange,
  inStockOnly,
  onInStockOnlyChange,
}) => {
  const [inspectedProduct, setInspectedProduct] = useState<AgentProductItem | null>(null);

  // Extract categories dynamically from products
  const rawCategories = Array.from(
    new Set(products.map((p) => p.category).filter((c): c is string => Boolean(c)))
  );
  const categories = ["All", ...rawCategories];

  // Filter products client-side
  const filteredProducts = products.filter((p) => {
    if (selectedCategory !== "All" && (p.category || "").toLowerCase() !== selectedCategory.toLowerCase()) {
      return false;
    }
    if (inStockOnly && p.stock <= 0) {
      return false;
    }
    if (maxPrice && maxPrice > 0) {
      const pricePaise = maxPrice < 10000 ? maxPrice * 100 : maxPrice;
      if (p.price > pricePaise) return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const match =
        p.name.toLowerCase().includes(q) ||
        (p.description || "").toLowerCase().includes(q) ||
        (p.category || "").toLowerCase().includes(q) ||
        p.slug.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  return (
    <div className="space-y-8 w-full">
      
      {/* Marquee Ticker Tape matching pod-store style */}
      <div className="w-full overflow-hidden border-y border-border py-2 bg-muted/30">
        <div className="marquee-track flex gap-8 text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground">
          <span>⚡ Autonomous AI Buyer Gateway Active</span>
          <span>•</span>
          <span>ZeroClick Streetwear Drops</span>
          <span>•</span>
          <span>Razorpay Bounded Test Checkout Rails</span>
          <span>•</span>
          <span>NPCI UAP Protocol Enabled</span>
          <span>•</span>
          <span>Machine-Readable Catalog API at /api/agent/catalog</span>
          <span>•</span>
          <span>⚡ Autonomous AI Buyer Gateway Active</span>
          <span>•</span>
          <span>ZeroClick Streetwear Drops</span>
          <span>•</span>
          <span>Razorpay Bounded Test Checkout Rails</span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-4 border-b border-border pb-6">
        
        {/* Category Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => onCategoryChange(category)}
              className={`px-4 py-1.5 text-xs font-mono font-bold uppercase tracking-wider border transition-colors whitespace-nowrap ${
                selectedCategory === category
                  ? "bg-foreground text-background border-foreground"
                  : "bg-muted/40 text-foreground border-border hover:bg-muted"
              }`}
            >
              {category === "All" ? "All Drops" : category}
            </button>
          ))}
        </div>

        {/* Search & Price Filter Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-2">
          
          {/* Search Box */}
          <div className="sm:col-span-6 relative">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="SEARCH DROPS..."
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              className="w-full bg-background border border-border pl-9 pr-8 py-2 text-xs font-mono font-bold uppercase tracking-wider text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-foreground transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchQueryChange("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Max Price Cap */}
          <div className="sm:col-span-3">
            <input
              type="number"
              placeholder="MAX PRICE INR (e.g. 1000)"
              value={maxPrice || ""}
              onChange={(e) => onMaxPriceChange(e.target.value ? parseFloat(e.target.value) : undefined)}
              className="w-full bg-background border border-border px-3 py-2 text-xs font-mono font-bold uppercase tracking-wider text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-foreground transition-colors"
            />
          </div>

          {/* In-Stock Toggle */}
          <div className="sm:col-span-3 flex items-center justify-start sm:justify-end">
            <label className="flex items-center space-x-2 px-3 py-2 border border-border bg-muted/40 cursor-pointer hover:bg-muted transition-colors w-full sm:w-auto justify-center">
              <input
                type="checkbox"
                checked={inStockOnly}
                onChange={(e) => onInStockOnlyChange(e.target.checked)}
                className="accent-foreground rounded-none"
              />
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-foreground">
                In-Stock Only
              </span>
            </label>
          </div>

        </div>

      </div>

      {/* Loading state */}
      {loading ? (
        <div className="py-24 text-center flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-foreground" />
          <span className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground">
            Loading Live Drops...
          </span>
        </div>
      ) : filteredProducts.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-12 w-full">
          {filteredProducts.map((product, idx) => (
            <ProductCard
              key={product.id || product.slug}
              product={product}
              index={idx}
              priority={idx === 0}
              onInspectJson={(agentItem) => setInspectedProduct(agentItem)}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-24 border border-dashed border-border flex flex-col items-center justify-center gap-4">
          <p className="text-muted-foreground text-sm uppercase tracking-widest font-mono font-bold">
            No active drops found.
          </p>
          <button
            onClick={() => {
              onCategoryChange("All");
              onSearchQueryChange("");
              onMaxPriceChange(undefined);
              onInStockOnlyChange(false);
            }}
            className="px-4 py-2 bg-foreground text-background text-xs font-mono font-bold uppercase tracking-wider hover:opacity-80"
          >
            Reset Filters
          </button>
        </div>
      )}

      {/* Inspect Item JSON Modal */}
      {inspectedProduct && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-background border-2 border-foreground max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/40">
              <div className="flex items-center space-x-2">
                <Bot className="w-5 h-5 text-foreground" />
                <h3 className="font-mono text-xs font-black uppercase tracking-wider text-foreground">
                  A2A Agent Payload: {inspectedProduct.sku}
                </h3>
              </div>
              <button
                onClick={() => setInspectedProduct(null)}
                className="text-foreground hover:opacity-70 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal JSON Body */}
            <div className="p-6 overflow-auto font-mono text-xs text-foreground bg-background leading-relaxed">
              <pre className="whitespace-pre-wrap">
                {JSON.stringify(inspectedProduct, null, 2)}
              </pre>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3.5 border-t border-border flex items-center justify-between text-xs font-mono bg-muted/30">
              <span className="text-muted-foreground uppercase font-bold text-[11px]">
                Ready for LLM Context Injection
              </span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(inspectedProduct, null, 2));
                  setInspectedProduct(null);
                }}
                className="px-4 py-1.5 bg-foreground text-background font-bold uppercase tracking-wider text-xs hover:opacity-80 transition-opacity"
              >
                Copy & Close
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
