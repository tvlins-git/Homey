import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { homeCheckConfigured, isHome, parseCoordsFromRequest } from "@/lib/home";
import "@/lib/homey";

export async function GET(request: Request) {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const coords = parseCoordsFromRequest(request);
  const result = await isHome(request, coords);
  return NextResponse.json({
    ...result,
    configured: homeCheckConfigured() || result.geoConfigured,
  });
}

export async function POST(request: Request) {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const coords = parseCoordsFromRequest(request, body);
  const result = await isHome(request, coords);
  return NextResponse.json({
    ...result,
    configured: homeCheckConfigured() || result.geoConfigured,
  });
}
