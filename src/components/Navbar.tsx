"use client";

import React from "react";
import { Bot, ShoppingBag, ArrowUpRight, MessageSquare } from "lucide-react";

export type ViewMode = "chat" | "agent" | "merchant";

interface NavbarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  selectedCategory: string;
  onCategoryChange: (cat: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  viewMode,
  onViewModeChange,
  onCategoryChange,
}) => {
  return (
    <header className="sticky top-0 z-50 bg-background/90 backdrop-blur-md border-b border-border transition-all duration-300">
      <div className="max-w-7xl mx-auto px-6 md:px-12">
        <div className="flex items-center justify-between h-16 md:h-20">
          
          {/* Brand Name matching pod-store */}
          <div className="flex items-center space-x-3">
            <button
              onClick={() => {
                onCategoryChange("All");
              }}
              className="font-black text-xl md:text-2xl tracking-tight uppercase hover:opacity-85 transition-opacity shrink-0 flex items-center gap-2"
            >
              <span>ZeroClick</span>
            </button>
            <span className="hidden sm:inline-block px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-widest bg-foreground text-background border border-foreground">
              Razorpay A2A
            </span>
          </div>

          {/* Right Navigation & View Switcher */}
          <div className="flex items-center space-x-3 sm:space-x-4">
            <div className="flex items-center bg-muted/60 p-1 border border-border">

              <button
                onClick={() => onViewModeChange("chat")}
                className={`flex items-center space-x-1.5 px-3 py-1 text-xs font-mono font-bold uppercase tracking-wider transition-colors ${
                  viewMode === "chat"
                    ? "bg-foreground text-background"
                    : "text-foreground hover:opacity-70"
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Chat</span>
              </button>

              <button
                onClick={() => onViewModeChange("agent")}
                className={`flex items-center space-x-1.5 px-3 py-1 text-xs font-mono font-bold uppercase tracking-wider transition-colors ${
                  viewMode === "agent"
                    ? "bg-foreground text-background"
                    : "text-foreground hover:opacity-70"
                }`}
              >
                <Bot className="w-3.5 h-3.5" />
                <span>A2A Inspector</span>
              </button>

              <button
                onClick={() => onViewModeChange("merchant")}
                className={`flex items-center space-x-1.5 px-3 py-1 text-xs font-mono font-bold uppercase tracking-wider transition-colors ${
                  viewMode === "merchant"
                    ? "bg-foreground text-background"
                    : "text-foreground hover:opacity-70"
                }`}
              >
                <ShoppingBag className="w-3.5 h-3.5" />
                <span>Merchant Control</span>
              </button>
            </div>

            <a
              href="/api/agent/catalog"
              target="_blank"
              rel="noreferrer"
              className="hidden md:flex items-center space-x-1 px-3 py-1 text-xs font-mono font-bold uppercase tracking-wider border border-border hover:bg-foreground hover:text-background transition-colors"
            >
              <span>/api/agent/catalog</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </a>
          </div>

        </div>
      </div>
    </header>
  );
};
