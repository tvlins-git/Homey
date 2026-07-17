export type HomeCoords = { lat: number; lng: number };

export type HomeResult = {
  home: boolean;
  reason: "ip" | "geo" | "away" | "disabled";
  clientIp: string | null;
  /** True when the client IP looks like iCloud Private Relay / privacy proxy. */
  proxied: boolean;
  geoConfigured: boolean;
};

type GeoConfig = {
  lat: number;
  lng: number;
  radiusM: number;
  source: "env" | "homey";
};

type HomeyLocationFetcher = () => Promise<HomeCoords | null>;

let homeyLocationFetcher: HomeyLocationFetcher | null = null;
let homeyGeoCache: { coords: HomeCoords | null; at: number } | null = null;
const HOMEY_GEO_TTL_MS = 60 * 60 * 1000;

/** Register Homey location lookup (avoids hard import cycles in tests). */
export function setHomeyLocationFetcher(fetcher: HomeyLocationFetcher | null) {
  homeyLocationFetcher = fetcher;
  homeyGeoCache = null;
}

function parseWanEntries(): string[] {
  const raw = process.env.HOME_WAN_IPS?.trim() ?? "";
  if (!raw) return [];
  return raw
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);
}

function parseEnvGeoConfig(): GeoConfig | null {
  const lat = Number(process.env.HOME_LAT);
  const lng = Number(process.env.HOME_LNG);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const radiusM = Number(process.env.HOME_RADIUS_M ?? "150");
  return {
    lat,
    lng,
    radiusM: Number.isFinite(radiusM) && radiusM > 0 ? radiusM : 150,
    source: "env",
  };
}

async function fetchHomeyCoords(): Promise<HomeCoords | null> {
  if (!homeyLocationFetcher) return null;
  const now = Date.now();
  if (homeyGeoCache && now - homeyGeoCache.at < HOMEY_GEO_TTL_MS) {
    return homeyGeoCache.coords;
  }
  try {
    const coords = await homeyLocationFetcher();
    homeyGeoCache = { coords, at: now };
    return coords;
  } catch {
    homeyGeoCache = { coords: null, at: now };
    return null;
  }
}

async function resolveGeoConfig(): Promise<GeoConfig | null> {
  const env = parseEnvGeoConfig();
  if (env) return env;
  const coords = await fetchHomeyCoords();
  if (!coords) return null;
  const radiusM = Number(process.env.HOME_RADIUS_M ?? "150");
  return {
    lat: coords.lat,
    lng: coords.lng,
    radiusM: Number.isFinite(radiusM) && radiusM > 0 ? radiusM : 150,
    source: "homey",
  };
}

export function homeCheckConfigured(): boolean {
  // Homey geo is discovered async; treat WAN IPs or env geo as configured.
  // When only Homey geo exists, isHome() still enables the check after lookup.
  return parseWanEntries().length > 0 || parseEnvGeoConfig() !== null;
}

/** Expand IPv6 to a full lowercase 8-hextet form for comparison. */
export function expandIpv6(ip: string): string {
  const cleaned = ip.toLowerCase().replace(/^\[|\]$/g, "");
  const [head, tail] = cleaned.split("::");
  const headParts = head ? head.split(":").filter(Boolean) : [];
  const tailParts = tail ? tail.split(":").filter(Boolean) : [];
  const missing = 8 - headParts.length - tailParts.length;
  const zeros = missing > 0 ? Array(missing).fill("0") : [];
  const parts = [...headParts, ...zeros, ...tailParts].map((p) =>
    p.padStart(4, "0"),
  );
  while (parts.length < 8) parts.push("0000");
  return parts.slice(0, 8).join(":");
}

export function normalizeIp(ip: string): string {
  let s = ip.trim().toLowerCase();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone);
  const v4mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4mapped) return v4mapped[1];
  if (s.includes(":")) return expandIpv6(s);
  return s;
}

/** Common iCloud Private Relay / privacy-proxy egress prefixes. */
export function isPrivacyProxyIp(ip: string | null): boolean {
  if (!ip) return false;
  const n = normalizeIp(ip);
  if (!n.includes(":")) return false;
  // Apple Private Relay IPv6 (most common on iPhone Safari)
  if (n.startsWith("2a09:bac2:") || n.startsWith("2a09:bac3:")) return true;
  // Additional Private Relay egress operated via Cloudflare in some regions
  if (n.startsWith("2a04:4e41:")) return true;
  return false;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    const oct = Number(part);
    if (!Number.isInteger(oct) || oct < 0 || oct > 255) return null;
    n = (n << 8) + oct;
  }
  return n >>> 0;
}

function ipv6ToBigInt(ip: string): bigint | null {
  try {
    const expanded = expandIpv6(ip);
    return BigInt(`0x${expanded.split(":").join("")}`);
  } catch {
    return null;
  }
}

function ipMatchesEntry(clientIp: string, entry: string): boolean {
  const [rawAddr, rawPrefix] = entry.split("/");
  if (!rawAddr) return false;
  const addr = normalizeIp(rawAddr);
  const client = normalizeIp(clientIp);

  if (rawPrefix === undefined) {
    return addr === client;
  }

  const prefix = Number(rawPrefix);
  if (!Number.isInteger(prefix) || prefix < 0) return false;

  const clientIsV6 = client.includes(":");
  const entryIsV6 = addr.includes(":");
  if (clientIsV6 !== entryIsV6) return false;

  if (!entryIsV6) {
    if (prefix > 32) return false;
    const c = ipv4ToInt(client);
    const a = ipv4ToInt(addr);
    if (c === null || a === null) return false;
    if (prefix === 0) return true;
    const mask = prefix === 32 ? 0xffffffff : (~0 << (32 - prefix)) >>> 0;
    return (c & mask) === (a & mask);
  }

  if (prefix > 128) return false;
  const c = ipv6ToBigInt(client);
  const a = ipv6ToBigInt(addr);
  if (c === null || a === null) return false;
  if (prefix === 0) return true;
  const shift = BigInt(128 - prefix);
  return c >> shift === a >> shift;
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
  const allowed = parseWanEntries();
  if (allowed.length === 0) return false;
  return allowed.some((entry) => ipMatchesEntry(ip, entry));
}

/** Haversine distance in meters. */
export function distanceMeters(a: HomeCoords, b: HomeCoords): number {
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

export function isHomeGeo(
  coords: HomeCoords | null | undefined,
  geo: GeoConfig | null,
): boolean {
  if (!coords || !geo) return false;
  if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return false;
  return distanceMeters(coords, { lat: geo.lat, lng: geo.lng }) <= geo.radiusM;
}

export function parseCoords(body: unknown): HomeCoords | null {
  if (!body || typeof body !== "object") return null;
  const { lat, lng } = body as { lat?: unknown; lng?: unknown };
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/** Coords from JSON body and/or ?lat=&lng= query (for GET requests). */
export function parseCoordsFromRequest(
  request: Request,
  body?: unknown,
): HomeCoords | null {
  const fromBody = parseCoords(body);
  if (fromBody) return fromBody;
  try {
    const url = new URL(request.url);
    const lat = Number(url.searchParams.get("lat"));
    const lng = Number(url.searchParams.get("lng"));
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  } catch {
    // ignore invalid URL
  }
  return null;
}

/**
 * Home = WAN IP match (exact or CIDR) OR coords within geofence.
 * Geofence uses HOME_LAT/HOME_LNG, or Homey's configured location as fallback.
 * If neither IP allowlist nor any geofence is available, returns home=true (disabled).
 */
export async function isHome(
  request: Request,
  coords?: HomeCoords | null,
): Promise<HomeResult> {
  const clientIp = getClientIp(request);
  const proxied = isPrivacyProxyIp(clientIp);
  const geo = await resolveGeoConfig();
  const wanConfigured = parseWanEntries().length > 0;
  const configured = wanConfigured || geo !== null;

  if (!configured) {
    return {
      home: true,
      reason: "disabled",
      clientIp,
      proxied,
      geoConfigured: false,
    };
  }

  if (isHomeIp(clientIp)) {
    return {
      home: true,
      reason: "ip",
      clientIp,
      proxied,
      geoConfigured: geo !== null,
    };
  }

  if (isHomeGeo(coords ?? null, geo)) {
    return {
      home: true,
      reason: "geo",
      clientIp,
      proxied,
      geoConfigured: true,
    };
  }

  return {
    home: false,
    reason: "away",
    clientIp,
    proxied,
    geoConfigured: geo !== null,
  };
}
