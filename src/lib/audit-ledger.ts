import fs from "fs";
import path from "path";

export interface AuditArithmetic {
  subtotal: number;
  discount: number;
  final_total: number;
  buyer_savings: number;
  incremental_revenue: number;
}

export interface AuditEvent {
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

const ledgerDir = path.join(process.cwd(), "src/data");
const ledgerPath = path.join(ledgerDir, "trust-ledger.json");

/**
 * Initializes the ledger file if it does not exist
 */
function initLedger() {
  if (!fs.existsSync(ledgerDir)) {
    fs.mkdirSync(ledgerDir, { recursive: true });
  }
  if (!fs.existsSync(ledgerPath)) {
    fs.writeFileSync(ledgerPath, JSON.stringify([], null, 2), "utf-8");
  }
}

/**
 * Appends a new audited event to the Trust Ledger file
 */
export function logAuditEvent(event: Omit<AuditEvent, "timestamp">) {
  try {
    initLedger();
    const data = fs.readFileSync(ledgerPath, "utf-8");
    const ledger: AuditEvent[] = JSON.parse(data);

    const newEvent: AuditEvent = {
      timestamp: new Date().toISOString(),
      ...event
    };

    ledger.push(newEvent);
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), "utf-8");
    console.log(`📜 [LEDGER] Logged action "${event.action}" | Result: ${event.policy_result} | Reason: ${event.reason_code}`);
  } catch (err) {
    console.error("❌ [LEDGER] Failed to write audit event:", err);
  }
}

/**
 * Retrieves all events from the Trust Ledger
 */
export function getAuditEvents(): AuditEvent[] {
  try {
    initLedger();
    const data = fs.readFileSync(ledgerPath, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    console.error("❌ [LEDGER] Failed to read audit events:", err);
    return [];
  }
}

/**
 * Groups raw Trust Ledger events into coherent, end-to-end Agent Activity Journeys
 */
export function getGroupedJourneys(): AgentJourney[] {
  const events = getAuditEvents();
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
