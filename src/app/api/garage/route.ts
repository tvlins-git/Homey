import { NextResponse } from "next/server";
import { requireSession, userCanAccessGroup } from "@/lib/auth";
import { getGarageState, setGarageOpen } from "@/lib/homey";
import { isHome, parseCoordsFromRequest } from "@/lib/home";

export async function GET(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const coords = parseCoordsFromRequest(request);
  const home = await isHome(request, coords);
  if (!userCanAccessGroup(session, "garage", home.home)) {
    return NextResponse.json(
      { error: "Forbidden", reason: "acl" },
      { status: 403 },
    );
  }

  try {
    const state = await getGarageState();
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
      open?: boolean;
      lat?: number;
      lng?: number;
    };
    if (typeof body.open !== "boolean") {
      return NextResponse.json(
        { error: "Body must include boolean open" },
        { status: 400 },
      );
    }

    const coords = parseCoordsFromRequest(request, body);
    const home = await isHome(request, coords);
    if (!userCanAccessGroup(session, "garage", home.home)) {
      return NextResponse.json(
        { error: "Not allowed", reason: home.home ? "acl" : "away" },
        { status: 403 },
      );
    }

    const state = await setGarageOpen(body.open);
    return NextResponse.json(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
