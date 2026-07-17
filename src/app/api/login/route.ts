import { NextResponse } from "next/server";
import {
  COOKIE_NAME,
  authenticateUser,
  createSessionCookieValue,
  sessionCookieOptions,
} from "@/lib/auth";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    username?: string;
    password?: string;
  } | null;

  const username = body?.username?.trim() ?? "";
  const password = body?.password ?? "";

  // Backward-compatible: password-only login as admin
  if (!username && password) {
    const adminName =
      process.env.ADMIN_USERNAME?.trim() ||
      process.env.DASHBOARD_ADMIN_USERNAME?.trim() ||
      "admin";
    const user = await authenticateUser(adminName, password);
    if (!user) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }
    const res = NextResponse.json({
      ok: true,
      user: { id: user.id, username: user.username, role: user.role },
    });
    res.cookies.set(
      COOKIE_NAME,
      createSessionCookieValue(user),
      sessionCookieOptions(),
    );
    return res;
  }

  if (!username || !password) {
    return NextResponse.json(
      { error: "Username and password required" },
      { status: 400 },
    );
  }

  const user = await authenticateUser(username, password);
  if (!user) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const res = NextResponse.json({
    ok: true,
    user: { id: user.id, username: user.username, role: user.role },
  });
  res.cookies.set(
    COOKIE_NAME,
    createSessionCookieValue(user),
    sessionCookieOptions(),
  );
  return res;
}
