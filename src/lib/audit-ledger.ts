import { getAdminSupabase, supabasePublic } from "@/lib/supabase";

export interface AuditArithmetic {
  subtotal: number;
  discount: number;
  final_total: number;
  buyer_savings: number;
  incremental_revenue: number;
}

export interface AuditEvent {
  id?: string;
  event_id?: string;
  timestamp: string;
  actor: "AI Buyer Agent" | "Merchant Revenue Agent" | "Gateway" | "Customer";
  action:
    | "CATALOG_QUERIED"
    | "BUNDLE_RECOMMENDED"
    | "NEGOTIATION_ATTEMPTED"
    | "QUOTE_ISSUED"
    | "CHECKOUT_BLOCKED"
    | "CHECKOUT_APPROVED"
    | "ORDER_CREATED"
    | "PAYMENT_CAPTURED"
    | "PAYMENT_FAILED"
    | "STOCK_RESTORATION";
  session_id?: string | null;
  cart_id?: string | null;
  quote_id?: string | null;
  order_id?: string | null;
  product_id?: string | null;
  policy_version?: string | null;
  amount_before?: number | null; // in INR
  amount_after?: number | null;  // in INR
  policy_result: "ALLOWED" | "REJECTED" | "BLOCKED";
  reason_code:
    | "BID_TOO_LOW"
    | "MANDATE_REQUIRED"
    | "OUT_OF_STOCK"
    | "BUDGET_EXCEEDED"
    | "PRICE_MISMATCH"
    | "QUOTE_SCOPE_MISMATCH"
    | "SUCCESS"
    | "REFUNDED"
    | "IDEMPOTENT_REUSE";
  outcome: "COMPLETED" | "RECOVERABLE" | "FAILED";
  details?: string;
  intent_summary?: string;
  matched_rules?: string[];
  gate_results?: Record<string, "PASS" | "FAIL">;
  arithmetic?: AuditArithmetic;
}

export interface AgentJourney {
  journey_id: string; // session_id or order_id
  started_at: string;
  last_activity: string;
  intent_summary: string;
  status: "COMPLETED" | "BLOCKED" | "FAILED" | "IN_PROGRESS";
  final_amount: number | null;
  policy_version: string;
  events: AuditEvent[];
  trace: {
    buyer_intent: string;
    matched_products: string[];
    arithmetic: AuditArithmetic | null;
    policy_version: string;
    gate_results: Record<string, "PASS" | "FAIL">;
    outcome: string;
    business_reason: string;
  };
}

// In-memory fallback event cache for resilient local and transient operations
const inMemoryEvents: AuditEvent[] = [];

/**
 * Appends a new audited event to Supabase trust_ledger_events table (Zero filesystem dependency)
 */
export async function appendAuditEvent(
  event: Omit<AuditEvent, "timestamp"> & { timestamp?: string; event_id?: string }
): Promise<{ success: boolean; event_id: string; error?: string }> {
  const timestamp = event.timestamp || new Date().toISOString();
  const event_id =
    event.event_id ||
    `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const journey_id =
    event.session_id ||
    event.order_id ||
    event.cart_id ||
    event.quote_id ||
    `journey_${Date.now()}`;

  let amount_paise: number | null = null;
  if (event.amount_after !== undefined && event.amount_after !== null) {
    amount_paise = Math.round(event.amount_after * 100);
  } else if (event.amount_before !== undefined && event.amount_before !== null) {
    amount_paise = Math.round(event.amount_before * 100);
  }

  const fullEvent: AuditEvent = {
    ...event,
    event_id,
    timestamp
  };

  // Upsert into in-memory buffer
  const existingIdx = inMemoryEvents.findIndex(e => e.event_id === event_id);
  if (existingIdx >= 0) {
    inMemoryEvents[existingIdx] = fullEvent;
  } else {
    inMemoryEvents.unshift(fullEvent);
    if (inMemoryEvents.length > 500) {
      inMemoryEvents.pop();
    }
  }

  try {
    const supabase = getAdminSupabase() || supabasePublic;
    if (supabase) {
      const { error } = await supabase.from("trust_ledger_events").upsert(
        {
          event_id,
          event_type: event.action,
          journey_id,
          session_id: event.session_id || null,
          cart_id: event.cart_id || null,
          order_id: event.order_id || null,
          quote_id: event.quote_id || null,
          product_id: event.product_id || null,
          policy_version: event.policy_version || "v1",
          status: event.outcome,
          error_code: event.reason_code,
          amount_paise,
          currency: "INR",
          payload: fullEvent,
          created_at: timestamp
        },
        { onConflict: "event_id" }
      );

      if (error) {
        console.warn("⚠️ [LEDGER] Supabase write notice (cached in memory):", error.message);
        return { success: true, event_id, error: error.message };
      }

      console.log(`📜 [LEDGER] [SUPABASE] Persisted "${event.action}" | Result: ${event.policy_result} | Reason: ${event.reason_code} | Event ID: ${event_id}`);
      return { success: true, event_id };
    }
  } catch (err: any) {
    console.warn("⚠️ [LEDGER] Supabase persistence exception (fallback to in-memory):", err?.message);
    return { success: true, event_id, error: err?.message };
  }

  console.log(`📜 [LEDGER] [MEMORY] Buffered "${event.action}" | Result: ${event.policy_result} | ID: ${event_id}`);
  return { success: true, event_id };
}

// Backward-compatible alias for existing imports
export const logAuditEvent = appendAuditEvent;

/**
 * Retrieves all events from Supabase trust_ledger_events (ordered newest first)
 */
export async function getAuditEvents(): Promise<AuditEvent[]> {
  try {
    const supabase = getAdminSupabase() || supabasePublic;
    if (supabase) {
      const { data, error } = await supabase
        .from("trust_ledger_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(300);

      if (!error && Array.isArray(data) && data.length > 0) {
        const dbEvents: AuditEvent[] = data.map((row: any) => {
          const payload =
            typeof row.payload === "object" && row.payload !== null
              ? row.payload
              : {};
          return {
            ...payload,
            id: row.id,
            event_id: row.event_id,
            timestamp: row.created_at || payload.timestamp || new Date().toISOString(),
            action: row.event_type || payload.action,
            session_id: row.session_id ?? payload.session_id,
            cart_id: row.cart_id ?? payload.cart_id,
            order_id: row.order_id ?? payload.order_id,
            quote_id: row.quote_id ?? payload.quote_id,
            product_id: row.product_id ?? payload.product_id,
            policy_version: row.policy_version ?? payload.policy_version,
            policy_result: payload.policy_result || (row.status === "FAILED" || row.status === "BLOCKED" ? "BLOCKED" : "ALLOWED"),
            reason_code: row.error_code ?? payload.reason_code,
            outcome: row.status ?? payload.outcome,
            actor: payload.actor || "AI Buyer Agent"
          } as AuditEvent;
        });

        // Merge any transient in-memory events that might not be in DB yet
        const dbIds = new Set(dbEvents.map(e => e.event_id).filter(Boolean));
        const transientOnly = inMemoryEvents.filter(e => e.event_id && !dbIds.has(e.event_id));
        return [...transientOnly, ...dbEvents];
      }
    }
  } catch (err: any) {
    console.warn("⚠️ [LEDGER] Could not query Supabase trust_ledger_events (using in-memory cache):", err?.message);
  }

  return inMemoryEvents;
}

/**
 * Groups raw Trust Ledger events into coherent, end-to-end Agent Activity Journeys
 */
export async function getGroupedJourneys(): Promise<AgentJourney[]> {
  const events = await getAuditEvents();
  const journeyMap = new Map<string, AuditEvent[]>();

  for (const event of events) {
    // Key by session_id, order_id, or quote_id
    const key = event.session_id || event.order_id || event.quote_id || `session_${event.timestamp.substring(0, 16)}`;
    if (!journeyMap.has(key)) {
      journeyMap.set(key, []);
    }
    journeyMap.get(key)!.push(event);
  }

  const journeys: AgentJourney[] = [];

  journeyMap.forEach((evList, key) => {
    evList.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const first = evList[0];
    const last = evList[evList.length - 1];

    let overallStatus: AgentJourney["status"] = "IN_PROGRESS";
    if (evList.some(e => e.outcome === "COMPLETED")) {
      overallStatus = "COMPLETED";
    } else if (evList.some(e => e.policy_result === "BLOCKED" || e.outcome === "FAILED")) {
      overallStatus = "BLOCKED";
    }

    const intentSummary =
      evList.find(e => e.intent_summary)?.intent_summary ||
      (evList.some(e => e.action === "BUNDLE_RECOMMENDED")
        ? "Buyer queried catalog and negotiated complete streetwear outfit bundle"
        : "Direct single item autonomous purchase inquiry");

    const matchedProducts: string[] = [];
    evList.forEach(e => {
      if (e.details && e.details.includes("Argentina")) matchedProducts.push("Argentina Sun Of May Tee");
      if (e.details && e.details.includes("Pants")) matchedProducts.push("Relaxed Cotton Pants");
      if (e.details && e.details.includes("Socks")) matchedProducts.push("Streetwear Crew Socks (3-Pack)");
      if (e.details && e.details.includes("Cap")) matchedProducts.push("Essential Streetwear Cap");
    });
    const uniqueProducts = Array.from(new Set(matchedProducts));
    if (uniqueProducts.length === 0) uniqueProducts.push("Argentina Sun Of May Tee");

    const arithmeticEvent = evList.find(e => e.arithmetic);
    const arithmetic = arithmeticEvent ? arithmeticEvent.arithmetic! : {
      subtotal: first.amount_before || 649,
      discount: (first.amount_before && last.amount_after) ? Math.max(0, first.amount_before - last.amount_after) : 0,
      final_total: last.amount_after || first.amount_before || 649,
      buyer_savings: (first.amount_before && last.amount_after) ? Math.max(0, first.amount_before - last.amount_after) : 0,
      incremental_revenue: (last.amount_after && last.amount_after > 649) ? last.amount_after - 649 : 0
    };

    const gateResults: Record<string, "PASS" | "FAIL"> = {
      "Autonomy Gate": "PASS",
      "Mandate Bound": "PASS",
      "Budget Cap Gate": "PASS",
      "Inventory Stock Gate": "PASS",
      "Quote Scope Match": "PASS"
    };

    evList.forEach(e => {
      if (e.reason_code === "MANDATE_REQUIRED") gateResults["Mandate Bound"] = "FAIL";
      if (e.reason_code === "BUDGET_EXCEEDED") gateResults["Budget Cap Gate"] = "FAIL";
      if (e.reason_code === "OUT_OF_STOCK") gateResults["Inventory Stock Gate"] = "FAIL";
      if (e.reason_code === "QUOTE_SCOPE_MISMATCH" || e.reason_code === "PRICE_MISMATCH") gateResults["Quote Scope Match"] = "FAIL";
    });

    const businessReason =
      last.details ||
      (last.outcome === "COMPLETED"
        ? "Transaction cleared all merchant policy constraints and completed autonomous settlement."
        : `Transaction halted by policy gate: ${last.reason_code}`);

    journeys.push({
      journey_id: key,
      started_at: first.timestamp,
      last_activity: last.timestamp,
      intent_summary: intentSummary,
      status: overallStatus,
      final_amount: (last.amount_after ?? first.amount_before) ?? null,
      policy_version: last.policy_version || first.policy_version || "v1",
      events: evList,
      trace: {
        buyer_intent: intentSummary,
        matched_products: uniqueProducts,
        arithmetic,
        policy_version: last.policy_version || first.policy_version || "v1",
        gate_results: gateResults,
        outcome: last.policy_result,
        business_reason: businessReason
      }
    });
  });

  return journeys.reverse();
}

