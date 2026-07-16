import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { listTriggerableFlows, triggerFlow, type FlowKind } from "@/lib/homey";

function isFlowKind(value: unknown): value is FlowKind {
  return value === "flow" || value === "advancedflow";
}

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const flows = await listTriggerableFlows();
    return NextResponse.json({ flows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = (await request.json()) as { id?: string; kind?: string };
    if (typeof body.id !== "string" || !body.id) {
      return NextResponse.json({ error: "Body must include flow id" }, { status: 400 });
    }
    if (!isFlowKind(body.kind)) {
      return NextResponse.json(
        { error: "Body must include kind: flow | advancedflow" },
        { status: 400 },
      );
    }
    const flow = await triggerFlow(body.id, body.kind);
    return NextResponse.json({ ok: true, flow });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
