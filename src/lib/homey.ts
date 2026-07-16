const CONTROLLABLE_CLASSES = new Set(["light", "socket"]);

export const ROOM_NAMES = {
  "living-room": "Living Room",
  "dining-room": "Dining Room",
} as const;

export type RoomSlug = keyof typeof ROOM_NAMES;

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

export type RoomState = {
  slug: RoomSlug;
  zoneId: string;
  zoneName: string;
  /** True when every controllable device is on */
  on: boolean;
  /** True when some devices are on and some are off */
  mixed: boolean;
  devices: { id: string; name: string; class: string; on: boolean }[];
};

export function isRoomSlug(value: string): value is RoomSlug {
  return value in ROOM_NAMES;
}

export async function getRoomState(slug: RoomSlug): Promise<RoomState> {
  const roomName = ROOM_NAMES[slug];
  const [zones, devices] = await Promise.all([
    homeyFetch<Record<string, HomeyZone>>("/api/manager/zones/zone"),
    homeyFetch<Record<string, HomeyDevice>>("/api/manager/devices/device"),
  ]);

  const zone = Object.values(zones).find((z) => z.name === roomName);
  if (!zone) throw new Error(`${roomName} zone not found`);

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

  const anyOn = roomDevices.some((d) => d.on);
  const allOn = roomDevices.length > 0 && roomDevices.every((d) => d.on);

  return {
    slug,
    zoneId: zone.id,
    zoneName: zone.name,
    on: allOn,
    mixed: anyOn && !allOn,
    devices: roomDevices,
  };
}

export async function setRoomPower(slug: RoomSlug, on: boolean): Promise<RoomState> {
  const state = await getRoomState(slug);
  await Promise.all(
    state.devices.map((device) =>
      homeyFetch(`/api/manager/devices/device/${device.id}/capability/onoff`, {
        method: "PUT",
        body: JSON.stringify({ value: on }),
      }),
    ),
  );
  return getRoomState(slug);
}

export async function setRoomDevicePower(
  slug: RoomSlug,
  deviceId: string,
  on: boolean,
): Promise<RoomState> {
  const state = await getRoomState(slug);
  const device = state.devices.find((d) => d.id === deviceId);
  if (!device) {
    throw new Error(`Device is not a ${ROOM_NAMES[slug]} light/socket`);
  }
  await homeyFetch(`/api/manager/devices/device/${deviceId}/capability/onoff`, {
    method: "PUT",
    body: JSON.stringify({ value: on }),
  });
  return getRoomState(slug);
}

/** @deprecated use getRoomState("living-room") */
export type LivingRoomState = Omit<RoomState, "slug">;

export async function getLivingRoomState(): Promise<RoomState> {
  return getRoomState("living-room");
}

export async function setLivingRoomPower(on: boolean): Promise<RoomState> {
  return setRoomPower("living-room", on);
}

export async function setLivingRoomDevicePower(
  deviceId: string,
  on: boolean,
): Promise<RoomState> {
  return setRoomDevicePower("living-room", deviceId, on);
}

const OPEN_GARAGE_NAME = "Open Garage Virtual";
const CLOSE_GARAGE_NAME = "Close Garage Virtual";
const GARAGE_SENSOR_NAME = "Garage Door";

export type GarageState = {
  open: boolean;
  sensorName: string;
  openDeviceId: string;
  closeDeviceId: string;
};

async function getDevices() {
  return homeyFetch<Record<string, HomeyDevice>>("/api/manager/devices/device");
}

function requireDevice(
  devices: Record<string, HomeyDevice>,
  name: string,
): HomeyDevice {
  const device = Object.values(devices).find((d) => d.name === name);
  if (!device) throw new Error(`Homey device not found: ${name}`);
  return device;
}

export async function getGarageState(): Promise<GarageState> {
  const devices = await getDevices();
  const openBtn = requireDevice(devices, OPEN_GARAGE_NAME);
  const closeBtn = requireDevice(devices, CLOSE_GARAGE_NAME);
  const sensor = requireDevice(devices, GARAGE_SENSOR_NAME);

  return {
    open: Boolean(sensor.capabilitiesObj?.alarm_motion?.value),
    sensorName: sensor.name,
    openDeviceId: openBtn.id,
    closeDeviceId: closeBtn.id,
  };
}

export async function setGarageOpen(open: boolean): Promise<GarageState> {
  const state = await getGarageState();
  const deviceId = open ? state.openDeviceId : state.closeDeviceId;
  await homeyFetch(`/api/manager/devices/device/${deviceId}/capability/button`, {
    method: "PUT",
    body: JSON.stringify({ value: true }),
  });
  // Sensor may lag; return requested intent with refreshed IDs
  const refreshed = await getGarageState();
  return { ...refreshed, open };
}
