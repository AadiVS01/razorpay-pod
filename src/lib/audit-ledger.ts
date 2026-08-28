import fs from "fs";
import path from "path";

export interface AuditEvent {
  timestamp: string;
  actor: "AI Buyer Agent" | "Merchant Revenue Agent" | "Gateway" | "Customer";
  action: "BUNDLE_RECOMMENDED" | "QUOTE_ISSUED" | "CHECKOUT_BLOCKED" | "CHECKOUT_APPROVED" | "ORDER_CREATED" | "PAYMENT_CAPTURED" | "PAYMENT_FAILED" | "STOCK_RESTORATION";
  quote_id: string | null;
  order_id: string | null;
  amount_before: number | null; // in INR
  amount_after: number | null;  // in INR
  policy_result: "ALLOWED" | "REJECTED" | "BLOCKED";
  reason_code: "BID_TOO_LOW" | "MANDATE_REQUIRED" | "OUT_OF_STOCK" | "BUDGET_EXCEEDED" | "PRICE_MISMATCH" | "SUCCESS" | "REFUNDED" | "IDEMPOTENT_REUSE";
  outcome: "COMPLETED" | "RECOVERABLE" | "FAILED";
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
