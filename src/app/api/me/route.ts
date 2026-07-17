import { NextResponse } from "next/server";
import { requireSession, userCanAccessGroup } from "@/lib/auth";
import { GROUPS } from "@/lib/groups";
import { homeCheckConfigured, isHome, parseCoordsFromRequest } from "@/lib/home";
import { canControl } from "@/lib/acl";
import "@/lib/homey";

function mePayload(
  session: NonNullable<Awaited<ReturnType<typeof requireSession>>>,
  home: Awaited<ReturnType<typeof isHome>>,
) {
  const groups = GROUPS.filter((g) =>
    userCanAccessGroup(session, g.id, home.home),
  ).map((g) => ({
    id: g.id,
    title: g.title,
    mode: session.acl[g.id],
  }));

  return {
    user: {
      id: session.id,
      username: session.username,
      role: session.role,
    },
    home: {
      ...home,
      configured: homeCheckConfigured() || home.geoConfigured,
    },
    acl: session.acl,
    groups,
    allGroups: GROUPS.map((g) => ({
      id: g.id,
      title: g.title,
      mode: session.acl[g.id],
      allowedNow: canControl(session.acl[g.id], home.home),
    })),
  };
}

export async function GET(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const coords = parseCoordsFromRequest(request);
  return NextResponse.json(mePayload(session, await isHome(request, coords)));
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const coords = parseCoordsFromRequest(request, body);
  return NextResponse.json(mePayload(session, await isHome(request, coords)));
}
