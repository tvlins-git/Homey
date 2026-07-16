import { NextResponse } from "next/server";
import { COOKIE_NAME, sessionCookieValue } from "@/lib/auth";

export async function POST(request: Request) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    return NextResponse.json({ ok: true });
  }

  const body = (await request.json().catch(() => null)) as { password?: string } | null;
  if (!body?.password || body.password !== password) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, sessionCookieValue(password), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
