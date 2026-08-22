"use client";

import React, { useState, useEffect } from "react";
import { Navbar, ViewMode } from "@/components/Navbar";
import { StorefrontView } from "@/components/StorefrontView";
import { AgentApiViewer } from "@/components/AgentApiViewer";
import { ChatWorkspace } from "@/components/ChatWorkspace";
import { Product } from "@/types/catalog";

export default function HomePage() {
  const [viewMode, setViewMode] = useState<ViewMode>("store");
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  // Shared Filter States
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [maxPrice, setMaxPrice] = useState<number | undefined>(undefined);
  const [inStockOnly, setInStockOnly] = useState<boolean>(false);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const res = await fetch("/api/agent/catalog");
        const json = await res.json();
        if (json && json.products) {
          const prods: Product[] = json.products.map((item: any) => ({
            id: item.id,
            name: item.name,
            description: item.ai_summary,
            price: item.price_paise,
            compare_price: item.compare_price_inr ? item.compare_price_inr * 100 : null,
            images: item.images || [],
            sizes: item.sizes || [],
            colors: item.colors || [],
            color_images: item.color_images || null,
            category: item.category,
            stock: item.stock,
            active: true,
            slug: item.slug,
          }));
          setProducts(prods);
        } else {
          setProducts([]);
        }
      } catch (err) {
        console.error("Failed to fetch products:", err);
        setProducts([]);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      
      {/* Navbar */}
      <Navbar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        selectedCategory={selectedCategory}
        onCategoryChange={setSelectedCategory}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 md:px-12 py-8">
        
        {viewMode === "store" ? (
          <div className="animate-in fade-in duration-200">
            <StorefrontView
              products={products}
              loading={loading}
              selectedCategory={selectedCategory}
              onCategoryChange={setSelectedCategory}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              maxPrice={maxPrice}
              onMaxPriceChange={setMaxPrice}
              inStockOnly={inStockOnly}
              onInStockOnlyChange={setInStockOnly}
            />
          </div>
        ) : viewMode === "chat" ? (
          <div className="animate-in fade-in duration-200">
            <ChatWorkspace />
          </div>
        ) : (
          <div className="animate-in fade-in duration-200">
            <AgentApiViewer
              selectedCategory={selectedCategory}
              onCategoryChange={setSelectedCategory}
              maxPrice={maxPrice}
              onMaxPriceChange={setMaxPrice}
              inStockOnly={inStockOnly}
              onInStockOnlyChange={setInStockOnly}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
            />
          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="border-t border-border py-12 mt-16 bg-muted/20">
        <div className="max-w-7xl mx-auto px-6 md:px-12 flex flex-col md:flex-row items-center justify-between gap-6 text-xs font-mono font-bold uppercase tracking-wider">
          
          <div className="flex items-center gap-3">
            <span className="text-sm font-black tracking-tight">ZeroClick</span>
            <span className="text-muted-foreground">•</span>
            <span className="text-muted-foreground">Razorpay A2A Commerce Gateway</span>
          </div>

          <div className="flex items-center gap-6 text-muted-foreground">
            <span>NPCI UAP Compliant</span>
            <span>•</span>
            <span>Bounded Razorpay Rails</span>
            <span>•</span>
            <span>Machine Schema v1.0</span>
          </div>

        </div>
      </footer>

    </div>
  );
}
