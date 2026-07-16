import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import {
  getRoomState,
  isRoomSlug,
  setRoomDevicePower,
  setRoomPower,
} from "@/lib/homey";

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, context: RouteContext) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await context.params;
  if (!isRoomSlug(slug)) {
    return NextResponse.json({ error: "Unknown room" }, { status: 404 });
  }

  try {
    const state = await getRoomState(slug);
    return NextResponse.json(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await context.params;
  if (!isRoomSlug(slug)) {
    return NextResponse.json({ error: "Unknown room" }, { status: 404 });
  }

  try {
    const body = (await request.json()) as {
      on?: boolean;
      deviceId?: string;
    };

    if (typeof body.on !== "boolean") {
      return NextResponse.json({ error: "Body must include boolean on" }, { status: 400 });
    }

    const state = body.deviceId
      ? await setRoomDevicePower(slug, body.deviceId, body.on)
      : await setRoomPower(slug, body.on);

    return NextResponse.json(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
