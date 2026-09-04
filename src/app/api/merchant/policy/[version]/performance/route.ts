import { NextRequest, NextResponse } from "next/server";
import { getPolicyPerformance } from "@/lib/merchant-config";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ version: string }> }
) {
  try {
    const { version } = await context.params;
    if (!version) {
      return NextResponse.json(
        { status: "error", error: "INVALID_VERSION", details: "Policy version parameter is required." },
        { status: 400 }
      );
    }

    const performanceData = await getPolicyPerformance(version);
    if (!performanceData) {
      return NextResponse.json(
        { status: "error", error: "POLICY_VERSION_NOT_FOUND", details: `Policy version "${version}" does not exist.` },
        { status: 404 }
      );
    }

    return NextResponse.json({
      status: "success",
      ...performanceData
    }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { status: "error", error: "PERFORMANCE_FETCH_FAILED", details: err?.message },
      { status: 500 }
    );
  }
}
