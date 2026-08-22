"use client";

import React, { useState, useEffect, useRef } from "react";
import { MessageSquare, X, Send, Bot, Terminal, ShoppingBag, ChevronUp, ChevronDown, RefreshCw, Sparkles } from "lucide-react";
import { CartQuote } from "@/lib/agent-service";
import { formatCurrency } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export const ChatDrawer: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<"human" | "agent">("human");
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Yo! Welcome to **ZeroClick**. Ask me to buy items, customize sizes/colors, or check out our active A2A bundle drops!",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>(["🟢 A2A Sales Assistant initialized and ready."]);
  const [cart, setCart] = useState<CartQuote | null>(null);

  const messageEndRef = useRef<HTMLDivElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userText = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userText }]);
    setLoading(true);

    const apiMessages = [
      ...messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user" as const, content: userText },
    ];

    try {
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages }),
      });

      const data = await response.json();

      if (data.reply) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      }
      if (data.logs) {
        setLogs((prev) => [...prev, ...data.logs]);
      }
      if (data.cart) {
        setCart(data.cart);
      }
    } catch (err) {
      console.error("Agent chat failed:", err);
      setLogs((prev) => [...prev, "❌ Network failure communicating with A2A Gateway."]);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setMessages([
      {
        role: "assistant",
        content: "Session reset. Ask me to find an outfit or start a new order drops query!",
      },
    ]);
    setCart(null);
    setLogs(["🟢 Fresh A2A context initialized."]);
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
      
      {/* Floating Toggle Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="bg-foreground text-background hover:opacity-90 px-5 py-3 border-2 border-foreground shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-center space-x-2 font-mono font-bold uppercase text-xs tracking-wider transition-all transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
        >
          <MessageSquare className="w-4 h-4" />
          <span>A2A Chat Assistant</span>
          {cart && (
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse ml-1" />
          )}
        </button>
      )}

      {/* Terminal Drawer Panel */}
      {isOpen && (
        <div className="bg-background border-2 border-foreground w-[360px] sm:w-[420px] h-[550px] shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col overflow-hidden animate-in slide-in-from-bottom-5 duration-200">
          
          {/* Header Bar */}
          <div className="bg-foreground text-background px-4 py-3 border-b border-foreground flex items-center justify-between shrink-0">
            <div className="flex items-center space-x-2">
              <Bot className="w-4 h-4 text-background" />
              <span className="font-mono text-xs font-black uppercase tracking-wider">
                ZeroClick A2A Terminal
              </span>
            </div>
            
            <div className="flex items-center space-x-2">
              <button
                onClick={handleReset}
                title="Reset Session"
                className="p-1 hover:bg-background/20 transition-colors rounded"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 hover:bg-background/20 transition-colors rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Mode Switcher & LED Status */}
          <div className="bg-muted/40 px-3 py-2 border-b border-border flex items-center justify-between text-[11px] font-mono shrink-0">
            <div className="flex space-x-1.5">
              <button
                onClick={() => setMode("human")}
                className={`px-2 py-0.5 font-bold uppercase transition-all ${
                  mode === "human"
                    ? "bg-foreground text-background"
                    : "text-foreground hover:opacity-75"
                }`}
              >
                Human Mode
              </button>
              <button
                onClick={() => setMode("agent")}
                className={`px-2 py-0.5 font-bold uppercase transition-all ${
                  mode === "agent"
                    ? "bg-foreground text-background"
                    : "text-foreground hover:opacity-75"
                }`}
              >
                AI Sim Mode
              </button>
            </div>

            <div className="flex items-center space-x-1.5 font-bold uppercase text-[10px] text-emerald-600">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Clerk online</span>
            </div>
          </div>

          {/* Main Body (Split into Chat vs Logs depending on Mode) */}
          <div className="flex-1 flex flex-col min-h-0 bg-background">
            
            {/* 1. Conversational Chat Panel */}
            <div className={`flex-1 overflow-y-auto p-4 space-y-4 ${mode === "agent" ? "h-[50%]" : "h-full"}`}>
              {messages.map((m, idx) => (
                <div
                  key={idx}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] px-3.5 py-2.5 text-xs font-medium leading-relaxed border ${
                      m.role === "user"
                        ? "bg-foreground text-background border-foreground shadow-[2px_2px_0px_0px_rgba(0,0,0,0.15)]"
                        : "bg-muted/20 text-foreground border-border"
                    }`}
                  >
                    <p className="whitespace-pre-wrap font-mono uppercase text-[11px] tracking-tight">{m.content}</p>
                  </div>
                </div>
              ))}
              
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-muted/20 border border-border px-3 py-2 text-xs font-mono font-bold uppercase tracking-wider text-muted-foreground flex items-center space-x-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>AI Clerk is typing...</span>
                  </div>
                </div>
              )}
              <div ref={messageEndRef} />
            </div>

            {/* 2. Protocol Logs Console (Visible in AI Sim Mode) */}
            {mode === "agent" && (
              <div className="h-[40%] bg-[#0B0F19] text-gray-300 border-t border-foreground p-3 overflow-y-auto font-mono text-[10px] space-y-1 select-none">
                <div className="text-[#38BDF8] font-bold uppercase border-b border-gray-800 pb-1 flex items-center justify-between mb-1.5">
                  <span className="flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5" />
                    <span>LPU Agent Telemetry Logs</span>
                  </span>
                  <span className="text-[9px] text-gray-500">Real-time Stream</span>
                </div>
                {logs.map((log, index) => (
                  <div key={index} className="leading-normal">
                    {log.startsWith("❌") || log.startsWith("[ERROR]") ? (
                      <span className="text-rose-400">{log}</span>
                    ) : log.startsWith("[CART]") ? (
                      <span className="text-emerald-400">{log}</span>
                    ) : log.startsWith("[UPSELL]") ? (
                      <span className="text-amber-400">{log}</span>
                    ) : (
                      <span className="text-gray-400">{log}</span>
                    )}
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            )}

          </div>

          {/* Cart Receipt & Checkout Block */}
          {cart && (
            <div className="border-t border-foreground bg-muted/30 p-3 shrink-0">
              <div className="flex items-center space-x-1.5 text-xs font-mono font-black uppercase text-foreground mb-1.5">
                <ShoppingBag className="w-4 h-4" />
                <span>Agent Cart Generated</span>
              </div>

              <div className="border border-border bg-background p-2 rounded-none space-y-1 font-mono text-[10px] leading-tight">
                {cart.items.map((item, index) => (
                  <div key={index} className="flex justify-between text-foreground">
                    <span className="font-bold">{item.name} ({item.size})</span>
                    <span>1 × {formatCurrency(item.price_paise)}</span>
                  </div>
                ))}
                
                <div className="border-t border-border pt-1 mt-1.5 flex justify-between font-black text-xs text-foreground uppercase tracking-wider">
                  <span>Cart Total:</span>
                  <span>{formatCurrency(cart.total_price_paise)}</span>
                </div>
              </div>

              <button
                onClick={() => alert(`Creating Razorpay Order for ${formatCurrency(cart.total_price_paise)}... (This triggers Layer 3 Checkout Guardrails)`)}
                className="w-full mt-2 bg-foreground text-background hover:opacity-85 py-1.5 text-xs font-mono font-black uppercase tracking-wider border border-foreground transition-opacity"
              >
                Proceed to Checkout
              </button>
            </div>
          )}

          {/* Message Input Form */}
          <form onSubmit={handleSend} className="p-3 border-t border-foreground flex gap-2 shrink-0 bg-background">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
              placeholder="ASK AGENT CLERK..."
              className="flex-1 bg-background border border-border px-3 py-2 text-xs font-mono font-bold uppercase tracking-wider placeholder:text-muted-foreground/60 text-foreground focus:outline-none focus:border-foreground"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="bg-foreground text-background px-4 py-2 border border-foreground font-mono font-bold uppercase text-xs tracking-wider transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>

        </div>
      )}

    </div>
  );
};
