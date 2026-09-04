"use client";

import React from "react";
import { ArrowUpRight, Shield, Zap } from "lucide-react";

export const Navbar: React.FC = () => {
  return (
    <header className="sticky top-0 z-50 bg-background/90 backdrop-blur-md border-b border-border transition-all duration-300">
      <div className="max-w-7xl mx-auto px-6 md:px-12">
        <div className="flex items-center justify-between h-16 md:h-20">
          
          {/* Brand Name */}
          <div className="flex items-center space-x-3">
            <a
              href="/"
              className="font-black text-xl md:text-2xl tracking-tight uppercase hover:opacity-85 transition-opacity shrink-0 flex items-center gap-2"
            >
              <span>ZeroClick</span>
            </a>
            <span className="hidden sm:inline-block px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase tracking-widest bg-foreground text-background border border-foreground rounded">
              Merchant Growth Platform
            </span>
          </div>

          {/* Right Header Status & Agent Endpoint */}
          <div className="flex items-center space-x-3 sm:space-x-4">
            <div className="hidden sm:flex items-center space-x-2 bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1 rounded-full text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Autonomous Rails Active</span>
            </div>

            <a
              href="/api/agent/catalog"
              target="_blank"
              rel="noreferrer"
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-mono font-bold uppercase tracking-wider border border-border hover:bg-foreground hover:text-background transition-colors rounded-lg bg-card"
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
