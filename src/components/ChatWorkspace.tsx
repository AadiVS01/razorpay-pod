"use client";

import React, { useState, useEffect, useRef } from "react";
import { Bot, RefreshCw, Play, CheckCircle2, ShieldAlert, X } from "lucide-react";
import { CartQuote } from "@/lib/agent-service";
import { formatCurrency } from "@/lib/utils";

interface Message {
  sender: "user" | "clerk" | "buyer-agent";
  content: string;
}

export const ChatWorkspace: React.FC = () => {
  // --- Left Side: Agent-to-Agent Simulator States ---
  const [a2aObjective, setA2aObjective] = useState("Buy the Argentina Tee and check for any pants bundle offers under 1800 INR");
  const [a2aBudget, setA2aBudget] = useState(2000);
  const [a2aMessages, setA2aMessages] = useState<Message[]>([]);
  const [a2aLogs, setA2aLogs] = useState<string[]>(["🟢 A2A Simulator idle. Enter objective and click Run."]);
  const [a2aLoading, setA2aLoading] = useState(false);
  const [a2aCart, setA2aCart] = useState<CartQuote | null>(null);
  const [gateApproved, setGateApproved] = useState<boolean | null>(null);

  // Payment rail status
  const [checkoutStatus, setCheckoutStatus] = useState<{
    status: "idle" | "loading" | "success" | "error";
    error?: string;
    orderId?: string;
    isA2a?: boolean;
    alternatives?: any[];
  }>({ status: "idle" });

  const a2aMsgEndRef = useRef<HTMLDivElement>(null);
  const a2aLogEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    a2aMsgEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [a2aMessages, a2aLoading]);

  useEffect(() => {
    a2aLogEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [a2aLogs]);

  // --- Left Side: Agent-to-Agent Autonomous Sim Run ---
  const runA2aSimulation = async () => {
    if (a2aLoading) return;

    setA2aLoading(true);
    setGateApproved(null);
    setA2aCart(null);
    setA2aMessages([]);
    setA2aLogs([
      "🤖 [A2A] Initializing Buyer Agent...",
      `🤖 [BUDGET] Setting pre-authorized budget cap: ${formatCurrency(a2aBudget * 100)}`,
      `🤖 [INTENT] Buyer Agent objective: "${a2aObjective}"`,
    ]);

    // Simulating step-by-step telemetry logs and messaging between Buyer and Clerk
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

    await wait(1200);
    setA2aLogs((p) => [...p, "🔍 [DISCOVERY] Fetching machine catalog from /api/agent/catalog..."]);
    
    try {
      const catalogRes = await fetch("/api/agent/catalog");
      const catalogData = await catalogRes.json();
      
      setA2aLogs((p) => [
        ...p,
        `🔍 [CATALOG] Found ${catalogData.total_items} items in catalog. Resolving SKUs...`,
        `🔍 [MATCH] Identified target: "Argentina Sun Of May Tee" (₹649).`,
      ]);

      await wait(1500);

      // Conversational flow exchange
      setA2aMessages((prev) => [
        ...prev,
        { sender: "buyer-agent", content: `Hello. I am the AI Buyer Agent representing customer. I need to purchase the Argentina Sun Of May Tee. My budget is ${formatCurrency(a2aBudget * 100)}.` }
      ]);
      setA2aLogs((p) => [...p, "💬 [COMMUNICATION] Sent purchase intent to Store Clerk."]);

      await wait(1800);

      // Get response from chat API to simulate clerk reasoning
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "user", content: `I am an AI buyer agent looking to buy the Argentina Sun Of May Tee. What bundle offers do you have? My budget is ${a2aBudget} INR.` }
          ]
        }),
      });
      const data = await res.json();

      setA2aMessages((prev) => [
        ...prev,
        { sender: "clerk", content: data.reply || "Yes, we have the Argentina Sun Of May Tee in stock. We can offer a Pants bundle for a 15% discount." }
      ]);
      setA2aLogs((p) => [
        ...p,
        "💬 [COMMUNICATION] Received clerk proposal.",
        "📊 [NEGOTIATION] Evaluating upsell bundle: Argentina Tee + Heavyweight Sweatpants.",
      ]);

      let finalCart: CartQuote = data.cart;
      if (!finalCart) {
        finalCart = {
          items: [
            {
              id: "977da225-f3ed-46a0-abf1-4ae18739e1a1",
              sku: "SKU-T-S-ARGE",
              name: "Argentina Sun Of May Tee",
              quantity: 1,
              price_paise: 64900,
              size: "L",
              color: "White",
            },
          ],
          total_price_paise: 64900,
        };
      }
      setA2aCart(finalCart);

      setA2aLogs((p) => [
        ...p,
        `📊 [VALIDATION] Combined total is ${formatCurrency(finalCart.total_price_paise)}.`,
        finalCart.total_price_paise <= (a2aBudget * 100)
          ? "✅ [BUDGET] Total meets budget cap constraint."
          : "❌ [BUDGET] Total exceeds budget cap limit!",
      ]);

      await wait(1500);
      setA2aLogs((p) => [...p, "💳 [A2A CHECKOUT] Automatically submitting checkout request to payment gateway..."]);

      const checkoutResult = await executeCheckout(finalCart, a2aBudget * 100, true);

      if (!checkoutResult) {
        setA2aLogs((p) => [...p, "⚠️ [A2A CHECKOUT] Checkout failed. Evaluating budget-friendly alternatives..."]);

        // Call orders endpoint again to get list of alternatives
        const resOrder = await fetch("/api/razorpay/order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: finalCart.items.map((i) => ({ id: i.id, quantity: i.quantity, size: i.size, color: i.color })),
            budget_cap_paise: a2aBudget * 100,
            expected_total_paise: finalCart.total_price_paise,
          }),
        });
        const orderData = await resOrder.json();

        if (orderData.alternatives && orderData.alternatives.length > 0) {
          const recoveryItem = orderData.alternatives[0];
          setA2aLogs((p) => [
            ...p,
            `🔄 [AUTONOMOUS RECOVERY] Found alternative: "${recoveryItem.name}" (₹${(recoveryItem.price_paise / 100).toFixed(2)}).`,
            `🔄 [AUTONOMOUS RECOVERY] Swapping cart and resubmitting checkout transaction...`,
          ]);

          const recoveryCart: CartQuote = {
            items: [
              {
                id: recoveryItem.id,
                sku: "SKU-ALT-T-L",
                name: recoveryItem.name,
                quantity: 1,
                price_paise: recoveryItem.price_paise,
                size: "L",
                color: "White",
              },
            ],
            total_price_paise: recoveryItem.price_paise,
          };
          setA2aCart(recoveryCart);

          await wait(1500);
          await executeCheckout(recoveryCart, a2aBudget * 100, true);
        } else {
          setA2aLogs((p) => [...p, "❌ [AUTONOMOUS RECOVERY] No matching budget alternatives found. Transaction aborted."]);
        }
      }

    } catch (err) {
      console.error(err);
      setA2aLogs((p) => [...p, "❌ [ERROR] A2A handshake failed."]);
    } finally {
      setA2aLoading(false);
    }
  };

  const executeCheckout = async (cartData: CartQuote, budgetCapPaise: number, isA2a: boolean) => {
    setCheckoutStatus({ status: "loading", isA2a });
    setA2aLogs((p) => [...p, `💳 [PAYMENT] Sending order to A2A Checkout Gateway...`]);

    try {
      const res = await fetch("/api/razorpay/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cartData.items.map((i) => ({ id: i.id, quantity: i.quantity, size: i.size, color: i.color })),
          budget_cap_paise: budgetCapPaise,
          expected_total_paise: cartData.total_price_paise,
          auto_capture: isA2a,
        }),
      });

      const data = await res.json();

      if (data.status === "success") {
        setCheckoutStatus({ status: "success", orderId: data.order_id, isA2a });
        setA2aLogs((p) => [
          ...p,
          `🎉 [SUCCESS] Razorpay Order created: ${data.order_id}`,
          `💳 [PAYMENT] Rails complete. Status: CAPTURED (Simulated Headless Webhook).`,
        ]);
        return data;
      } else {
        setCheckoutStatus({
          status: "error",
          error: `${data.error}: ${data.details || ""}`,
          isA2a,
          alternatives: data.alternatives,
        });
        setA2aLogs((p) => [
          ...p,
          `❌ [FAIL] Checkout Gateway declined transaction: ${data.error}`,
          `❌ [REASON] ${data.details || ""}`,
        ]);
        if (data.alternatives && data.alternatives.length > 0) {
          setA2aLogs((p) => [
            ...p,
            `💡 [RECOVERY] Recommended alternative(s): ${data.alternatives.map((a: any) => `${a.name} (₹${a.price_paise / 100})`).join(", ")}`,
          ]);
        }
        return null;
      }
    } catch (err: any) {
      const errMsg = err.message || "Network Error";
      setCheckoutStatus({ status: "error", error: errMsg, isA2a });
      setA2aLogs((p) => [...p, `❌ [FAIL] Gateway connection error: ${errMsg}`]);
      return null;
    }
  };

  const handleApprove = async () => {
    setGateApproved(true);
    setA2aLogs((p) => [...p, "🔐 [SECURITY] Transaction approved by user signature."]);
    if (a2aCart) {
      await executeCheckout(a2aCart, a2aBudget * 100, true);
    }
  };

  const handleDecline = () => {
    setGateApproved(false);
    setA2aLogs((p) => [
      ...p,
      "🚫 [SECURITY] Transaction declined by user.",
      "🛑 [STOP] Autonomous execution halted.",
    ]);
  };

  return (
    <div className="max-w-3xl mx-auto w-full min-h-[70vh]">
      
      {/* ================= LEFT SIDE: AGENT-TO-AGENT SIMULATOR ================= */}
      <div className="border-2 border-foreground bg-background p-6 flex flex-col min-h-[550px] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
        
        {/* Title */}
        <div className="flex items-center justify-between border-b-2 border-foreground pb-4 mb-4">
          <div className="flex items-center space-x-2">
            <Bot className="w-5 h-5 text-foreground" />
            <h2 className="font-mono text-sm font-black uppercase tracking-wider text-foreground">
              ZeroClick Autonomous Panel (AI Buyer ↔ AI Clerk)
            </h2>
          </div>
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
        </div>

        {/* Configuration inputs */}
        <div className="space-y-3 mb-6 bg-muted/30 p-3 border border-border">
          <div>
            <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground mb-1">
              AI Buyer Objective Prompt
            </label>
            <input
              type="text"
              value={a2aObjective}
              onChange={(e) => setA2aObjective(e.target.value)}
              disabled={a2aLoading}
              className="w-full bg-background border border-border px-2.5 py-1.5 text-xs font-mono font-bold uppercase tracking-wider focus:outline-none focus:border-foreground"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground mb-1">
                Budget Cap (INR)
              </label>
              <input
                type="number"
                value={a2aBudget}
                onChange={(e) => setA2aBudget(Number(e.target.value))}
                disabled={a2aLoading}
                className="w-full bg-background border border-border px-2.5 py-1.5 text-xs font-mono font-bold uppercase tracking-wider focus:outline-none focus:border-foreground"
              />
            </div>
            
            <div className="flex items-end">
              <button
                onClick={runA2aSimulation}
                disabled={a2aLoading}
                className="w-full bg-foreground text-background hover:opacity-85 py-1.5 border border-foreground text-xs font-mono font-black uppercase tracking-widest flex items-center justify-center space-x-1.5 transition-opacity"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Run Agentic Buy</span>
              </button>
            </div>
          </div>
        </div>

        {/* Messages Stream */}
        <div className="flex-1 overflow-y-auto border border-border bg-muted/10 p-4 space-y-4 max-h-[380px] mb-4 min-h-[280px]">
          {a2aMessages.length === 0 && !a2aLoading && (
            <div className="text-center py-16 text-muted-foreground font-mono text-xs uppercase font-bold">
              Simulation idle. Configure objectives above and run.
            </div>
          )}

          {a2aMessages.map((m, idx) => (
            <div
              key={idx}
              className={`flex ${m.sender === "buyer-agent" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] px-3.5 py-2.5 border text-sm font-mono leading-relaxed ${
                  m.sender === "buyer-agent"
                    ? "bg-[#0B0F19] text-gray-200 border-gray-800"
                    : "bg-background text-foreground border-foreground shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                }`}
              >
                <span className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1">
                  {m.sender === "buyer-agent" ? "🤖 AI Buyer Agent" : "💁 AI Store Clerk"}
                </span>
                <p className="uppercase text-sm tracking-tight">{m.content}</p>
              </div>
            </div>
          ))}

          {a2aLoading && (
            <div className="flex justify-start">
              <div className="bg-muted/30 border border-border px-3 py-2 text-xs font-mono font-bold uppercase tracking-wider text-muted-foreground flex items-center space-x-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>AI Agents Negotiating...</span>
              </div>
            </div>
          )}
          <div ref={a2aMsgEndRef} />
        </div>

        {/* A2A Transaction Telemetry Ledger (Read-Only) */}
        {a2aCart && (
          <div className="border-t-2 border-dashed border-foreground pt-4 bg-muted/10 p-3 shrink-0">
            <div className="flex items-center space-x-1.5 text-xs font-mono font-black uppercase text-foreground mb-2">
              <ShieldAlert className="w-4 h-4 text-emerald-500" />
              <span>A2A Transaction Telemetry Ledger</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              <div className="font-mono text-[10px] leading-tight space-y-1">
                <p className="text-muted-foreground uppercase">Active Cart Value:</p>
                <p className="text-xs font-bold text-foreground">{formatCurrency(a2aCart.total_price_paise)}</p>
                <p className="text-[9px] text-emerald-600 uppercase font-bold">
                  ✓ Bounded Cap: {formatCurrency(a2aBudget * 100)} Limit
                </p>
              </div>

              <div className="flex space-x-2 justify-end">
                {checkoutStatus.status === "success" && checkoutStatus.isA2a ? (
                  <div className="text-emerald-600 font-bold font-mono text-[11px] uppercase flex items-center space-x-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Transacted</span>
                  </div>
                ) : checkoutStatus.status === "error" && checkoutStatus.isA2a ? (
                  <div className="text-rose-600 font-bold font-mono text-[11px] uppercase flex items-center space-x-1.5">
                    <X className="w-4 h-4" />
                    <span>Failed Bounds</span>
                  </div>
                ) : (
                  <div className="text-amber-500 font-bold font-mono text-[11px] uppercase flex items-center space-x-1.5 animate-pulse">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Processing</span>
                  </div>
                )}
              </div>

              {checkoutStatus.status !== "idle" && checkoutStatus.isA2a && (
                <div className="col-span-1 md:col-span-2 mt-2 pt-2 border-t border-border font-mono text-[10px] uppercase font-bold">
                  {checkoutStatus.status === "loading" && (
                    <span className="text-muted-foreground animate-pulse">⏳ Processing autonomous A2A payment rails...</span>
                  )}
                  {checkoutStatus.status === "success" && (
                    <span className="text-emerald-600">✅ Rails Success! Order ID: {checkoutStatus.orderId} logged to DB.</span>
                  )}
                  {checkoutStatus.status === "error" && (
                    <span className="text-rose-600">❌ Rails Failed: {checkoutStatus.error}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

      </div>

    </div>
  );
};
