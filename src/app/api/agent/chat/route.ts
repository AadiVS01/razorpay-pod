import { NextRequest, NextResponse } from "next/server";
import { getAgentChatResponse } from "@/lib/agent-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { messages } = body;

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { status: "error", error: "Missing or invalid 'messages' array in request body" },
        { status: 400 }
      );
    }

    const result = await getAgentChatResponse(messages);

    // Print logs to server terminal console for developer visibility
    console.log("\n=======================================================");
    console.log("💬 [A2A CHAT DIALOGUE] Telemetry Log Stream");
    console.log("=======================================================");
    result.logs.forEach(log => console.log(log));
    console.log("=======================================================\n");

    return NextResponse.json(result, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  } catch (error: any) {
    console.error("Agent chat API error:", error);
    return NextResponse.json(
      {
        status: "error",
        error: "Failed to process agent dialogue",
        details: error?.message || "Internal server error",
      },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
