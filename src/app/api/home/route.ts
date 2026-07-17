import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { homeCheckConfigured, isHome, parseCoords } from "@/lib/home";

export async function GET(request: Request) {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = isHome(request);
  return NextResponse.json({
    ...result,
    geoConfigured: Boolean(
      process.env.HOME_LAT && process.env.HOME_LNG,
    ),
    configured: homeCheckConfigured(),
  });
}

export async function POST(request: Request) {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const coords = parseCoords(body);
  const result = isHome(request, coords);
  return NextResponse.json({
    ...result,
    geoConfigured: Boolean(
      process.env.HOME_LAT && process.env.HOME_LNG,
    ),
    configured: homeCheckConfigured(),
  });
}
