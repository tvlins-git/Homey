import { NextResponse } from "next/server";
import { requireSession, userCanAccessGroup } from "@/lib/auth";
import {
  getRoomState,
  isRoomSlug,
  setRoomDevicePower,
  setRoomPower,
} from "@/lib/homey";
import { isHome, parseCoordsFromRequest } from "@/lib/home";

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(request: Request, context: RouteContext) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await context.params;
  if (!isRoomSlug(slug)) {
    return NextResponse.json({ error: "Unknown room" }, { status: 404 });
  }

  const coords = parseCoordsFromRequest(request);
  const home = await isHome(request, coords);
  if (!userCanAccessGroup(session, slug, home.home)) {
    return NextResponse.json(
      { error: "Forbidden", reason: "acl" },
      { status: 403 },
    );
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
  const session = await requireSession();
  if (!session) {
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
      lat?: number;
      lng?: number;
    };

    if (typeof body.on !== "boolean") {
      return NextResponse.json(
        { error: "Body must include boolean on" },
        { status: 400 },
      );
    }

    const coords = parseCoordsFromRequest(request, body);
    const home = await isHome(request, coords);
    if (!userCanAccessGroup(session, slug, home.home)) {
      return NextResponse.json(
        { error: "Not allowed", reason: home.home ? "acl" : "away" },
        { status: 403 },
      );
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
