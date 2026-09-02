import { NextResponse } from "next/server";
import { getAuditEvents, getGroupedJourneys } from "@/lib/audit-ledger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const events = getAuditEvents();
    const journeys = getGroupedJourneys();
    return NextResponse.json(
      { status: "success", events, journeys },
      {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      { status: "error", error: "LEDGER_READ_FAILED", details: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
