export type HomeCoords = { lat: number; lng: number };

export type HomeResult = {
  home: boolean;
  reason: "ip" | "geo" | "away" | "disabled";
};

function parseWanIps(): string[] {
  const raw = process.env.HOME_WAN_IPS?.trim() ?? "";
  if (!raw) return [];
  return raw
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);
}

function parseGeoConfig(): {
  lat: number;
  lng: number;
  radiusM: number;
} | null {
  const lat = Number(process.env.HOME_LAT);
  const lng = Number(process.env.HOME_LNG);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const radiusM = Number(process.env.HOME_RADIUS_M ?? "150");
  return {
    lat,
    lng,
    radiusM: Number.isFinite(radiusM) && radiusM > 0 ? radiusM : 150,
  };
}

export function homeCheckConfigured(): boolean {
  return parseWanIps().length > 0 || parseGeoConfig() !== null;
}

export function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return null;
}

export function isHomeIp(ip: string | null): boolean {
  if (!ip) return false;
  const allowed = parseWanIps();
  if (allowed.length === 0) return false;
  return allowed.includes(ip);
}

/** Haversine distance in meters. */
export function distanceMeters(
  a: HomeCoords,
  b: HomeCoords,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isHomeGeo(coords: HomeCoords | null | undefined): boolean {
  if (!coords) return false;
  if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return false;
  const cfg = parseGeoConfig();
  if (!cfg) return false;
  return distanceMeters(coords, { lat: cfg.lat, lng: cfg.lng }) <= cfg.radiusM;
}

export function parseCoords(body: unknown): HomeCoords | null {
  if (!body || typeof body !== "object") return null;
  const { lat, lng } = body as { lat?: unknown; lng?: unknown };
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * Home = WAN IP match OR coords within geofence.
 * If neither IP allowlist nor geofence is configured, returns home=true (disabled).
 */
export function isHome(
  request: Request,
  coords?: HomeCoords | null,
): HomeResult {
  if (!homeCheckConfigured()) {
    return { home: true, reason: "disabled" };
  }

  const ip = getClientIp(request);
  if (isHomeIp(ip)) {
    return { home: true, reason: "ip" };
  }

  if (isHomeGeo(coords ?? null)) {
    return { home: true, reason: "geo" };
  }

  return { home: false, reason: "away" };
}
