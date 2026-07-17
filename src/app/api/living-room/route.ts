import { NextResponse } from "next/server";
import { requireSession, userCanAccessGroup } from "@/lib/auth";
import {
  getRoomState,
  setRoomDevicePower,
  setRoomPower,
} from "@/lib/homey";
import { isHome, parseCoords } from "@/lib/home";

/** Kept for compatibility; prefer /api/rooms/living-room */
export async function GET(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const home = isHome(request);
  if (!userCanAccessGroup(session, "living-room", home.home)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const state = await getRoomState("living-room");
    return NextResponse.json(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = (await request.json()) as {
      on?: boolean;
      deviceId?: string;
      lat?: number;
      lng?: number;
    };

    if (typeof body.on !== "boolean") {
      return NextResponse.json(
        { error: "Body must include boolean on" },
        { status: 400 },
      );
    }

    const home = isHome(request, parseCoords(body));
    if (!userCanAccessGroup(session, "living-room", home.home)) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }

    const state = body.deviceId
      ? await setRoomDevicePower("living-room", body.deviceId, body.on)
      : await setRoomPower("living-room", body.on);
    return NextResponse.json(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
