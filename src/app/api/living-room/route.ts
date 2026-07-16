import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getLivingRoomState, setLivingRoomPower } from "@/lib/homey";

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const state = await getLivingRoomState();
    return NextResponse.json(state);
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
    const body = (await request.json()) as { on?: boolean };
    if (typeof body.on !== "boolean") {
      return NextResponse.json({ error: "Body must include boolean on" }, { status: 400 });
    }
    const state = await setLivingRoomPower(body.on);
    return NextResponse.json(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
