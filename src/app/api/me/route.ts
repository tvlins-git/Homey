import { NextResponse } from "next/server";
import { requireSession, userCanAccessGroup } from "@/lib/auth";
import { GROUPS } from "@/lib/groups";
import { homeCheckConfigured, isHome, parseCoordsFromRequest } from "@/lib/home";
import { canControl } from "@/lib/acl";
import {
  getUserById,
  updateUserPassword,
  verifyPassword,
} from "@/lib/users";
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

export async function PATCH(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.id === "dev") {
    return NextResponse.json(
      { error: "Password changes require configured auth" },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    currentPassword?: string;
    newPassword?: string;
  } | null;

  const currentPassword = body?.currentPassword ?? "";
  const newPassword = body?.newPassword ?? "";
  if (!currentPassword || !newPassword) {
    return NextResponse.json(
      { error: "currentPassword and newPassword required" },
      { status: 400 },
    );
  }

  const user = await getUserById(session.id);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!verifyPassword(currentPassword, user.passwordHash)) {
    return NextResponse.json(
      { error: "Current password is incorrect" },
      { status: 400 },
    );
  }

  try {
    await updateUserPassword(user.id, newPassword);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Password update failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
