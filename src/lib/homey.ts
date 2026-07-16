import { ROOM_NAMES, type RoomSlug } from "@/lib/rooms";

export { ROOM_NAMES, ROOMS, type RoomSlug } from "@/lib/rooms";

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

const OPEN_GARAGE_FLOW = "Open Garage";
const CLOSE_GARAGE_FLOW = "Close Garage";
const GARAGE_SENSOR_NAME = "Garage Door";

type HomeyFlowRecord = {
  id: string;
  name: string;
  enabled?: boolean;
  triggerable?: boolean;
  folder?: string | null;
};

type FlowKind = "flow" | "advancedflow";

type FlowSummary = {
  id: string;
  name: string;
  kind: FlowKind;
};

export type GarageState = {
  open: boolean;
  sensorName: string;
  openFlowId: string;
  closeFlowId: string;
  openFlowKind: FlowKind;
  closeFlowKind: FlowKind;
};

function toTriggerableFlows(
  records: Record<string, HomeyFlowRecord>,
  kind: FlowKind,
): FlowSummary[] {
  return Object.values(records)
    .filter((f) => f.enabled !== false && f.triggerable === true)
    .map((f) => ({ id: f.id, name: f.name, kind }));
}

async function listTriggerableFlows(): Promise<FlowSummary[]> {
  const [classic, advanced] = await Promise.all([
    homeyFetch<Record<string, HomeyFlowRecord>>("/api/manager/flow/flow"),
    homeyFetch<Record<string, HomeyFlowRecord>>(
      "/api/manager/flow/advancedflow",
    ),
  ]);
  return [
    ...toTriggerableFlows(classic, "flow"),
    ...toTriggerableFlows(advanced, "advancedflow"),
  ];
}

function requireFlow(flows: FlowSummary[], name: string): FlowSummary {
  const flow = flows.find((f) => f.name === name);
  if (!flow) {
    throw new Error(`Homey flow not found or not triggerable: ${name}`);
  }
  return flow;
}

async function triggerFlow(flow: FlowSummary): Promise<void> {
  const path =
    flow.kind === "advancedflow"
      ? `/api/manager/flow/advancedflow/${flow.id}/trigger`
      : `/api/manager/flow/flow/${flow.id}/trigger`;
  await homeyFetch(path, { method: "POST", body: "{}" });
}

export async function getGarageState(): Promise<GarageState> {
  const [devices, flows] = await Promise.all([
    homeyFetch<Record<string, HomeyDevice>>("/api/manager/devices/device"),
    listTriggerableFlows(),
  ]);

  const sensor = Object.values(devices).find((d) => d.name === GARAGE_SENSOR_NAME);
  if (!sensor) throw new Error(`Homey device not found: ${GARAGE_SENSOR_NAME}`);

  const openFlow = requireFlow(flows, OPEN_GARAGE_FLOW);
  const closeFlow = requireFlow(flows, CLOSE_GARAGE_FLOW);

  return {
    open: Boolean(sensor.capabilitiesObj?.alarm_motion?.value),
    sensorName: sensor.name,
    openFlowId: openFlow.id,
    closeFlowId: closeFlow.id,
    openFlowKind: openFlow.kind,
    closeFlowKind: closeFlow.kind,
  };
}

export async function setGarageOpen(open: boolean): Promise<GarageState> {
  const state = await getGarageState();
  const flow: FlowSummary = open
    ? {
        id: state.openFlowId,
        name: OPEN_GARAGE_FLOW,
        kind: state.openFlowKind,
      }
    : {
        id: state.closeFlowId,
        name: CLOSE_GARAGE_FLOW,
        kind: state.closeFlowKind,
      };
  await triggerFlow(flow);
  // Sensor may lag; return requested intent with refreshed flow IDs
  const refreshed = await getGarageState();
  return { ...refreshed, open };
}
