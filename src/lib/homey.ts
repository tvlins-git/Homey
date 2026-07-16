const LIVING_ROOM_NAME = "Living Room";
const CONTROLLABLE_CLASSES = new Set(["light", "socket"]);

function getConfig() {
  const url = process.env.HOMEY_URL?.replace(/\/$/, "");
  const token = process.env.HOMEY_TOKEN;
  if (!url || !token) {
    throw new Error("Missing HOMEY_URL or HOMEY_TOKEN");
  }
  return { url, token };
}

async function homeyFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { url, token } = getConfig();
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Homey ${res.status}: ${body.slice(0, 200)}`);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

type HomeyZone = { id: string; name: string };
type HomeyDevice = {
  id: string;
  name: string;
  zone: string;
  class?: string;
  capabilities?: string[];
  capabilitiesObj?: Record<string, { value?: unknown }>;
};

export type LivingRoomState = {
  zoneId: string;
  zoneName: string;
  on: boolean;
  devices: { id: string; name: string; class: string; on: boolean }[];
};

export async function getLivingRoomState(): Promise<LivingRoomState> {
  const [zones, devices] = await Promise.all([
    homeyFetch<Record<string, HomeyZone>>("/api/manager/zones/zone"),
    homeyFetch<Record<string, HomeyDevice>>("/api/manager/devices/device"),
  ]);

  const zone = Object.values(zones).find((z) => z.name === LIVING_ROOM_NAME);
  if (!zone) throw new Error("Living Room zone not found");

  const roomDevices = Object.values(devices)
    .filter(
      (d) =>
        d.zone === zone.id &&
        CONTROLLABLE_CLASSES.has(d.class ?? "") &&
        (d.capabilities ?? []).includes("onoff"),
    )
    .map((d) => ({
      id: d.id,
      name: d.name,
      class: d.class ?? "unknown",
      on: Boolean(d.capabilitiesObj?.onoff?.value),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const on = roomDevices.some((d) => d.on);

  return {
    zoneId: zone.id,
    zoneName: zone.name,
    on,
    devices: roomDevices,
  };
}

export async function setLivingRoomPower(on: boolean): Promise<LivingRoomState> {
  const state = await getLivingRoomState();
  await Promise.all(
    state.devices.map((device) =>
      homeyFetch(`/api/manager/devices/device/${device.id}/capability/onoff`, {
        method: "PUT",
        body: JSON.stringify({ value: on }),
      }),
    ),
  );
  return getLivingRoomState();
}
