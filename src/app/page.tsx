"use client";

import React from "react";
import { Navbar } from "@/components/Navbar";
import { MerchantControlCenter } from "@/components/MerchantControlCenter";

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      
      {/* Merchant Navbar */}
      <Navbar />

      {/* Main Merchant Control Center */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 md:px-12 py-8">
        <div className="animate-in fade-in duration-200">
          <MerchantControlCenter />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-12 mt-16 bg-muted/20">
        <div className="max-w-7xl mx-auto px-6 md:px-12 flex flex-col md:flex-row items-center justify-between gap-6 text-xs font-mono font-bold uppercase tracking-wider">
          
          <div className="flex items-center gap-3">
            <span className="text-sm font-black tracking-tight">ZeroClick</span>
            <span className="text-muted-foreground">•</span>
            <span className="text-muted-foreground">Autonomous Merchant Growth Platform</span>
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
