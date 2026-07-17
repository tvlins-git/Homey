import { setHomeyLocationFetcher, type HomeCoords } from "@/lib/home";
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
const GARAGE_STATUS_VARIABLE = "isGarageOpen";
const BETTER_LOGIC_APP = "net.i-dev.betterlogic";

type HomeyFlowRecord = {
  id: string;
  name: string;
  enabled?: boolean;
  triggerable?: boolean;
  folder?: string | null;
};

type HomeyAdvancedFlow = HomeyFlowRecord & {
  cards?: Record<
    string,
    { id: string; type?: string; args?: Record<string, unknown> }
  >;
};

type HomeyClassicFlow = HomeyFlowRecord & {
  actions?: { id: string; uri?: string; args?: Record<string, unknown> }[];
};

type FlowKind = "flow" | "advancedflow";

type FlowSummary = {
  id: string;
  name: string;
  kind: FlowKind;
  triggerable: boolean;
};

export type GarageState = {
  /** From Better Logic `isGarageOpen` (true = open). */
  open: boolean;
  statusVariable: string;
  openFlowId: string;
  closeFlowId: string;
  openFlowKind: FlowKind;
  closeFlowKind: FlowKind;
  openFlowTriggerable: boolean;
  closeFlowTriggerable: boolean;
};

type BetterLogicVariable = {
  name: string;
  type?: string;
  value?: unknown;
};

async function getBetterLogicBoolean(name: string): Promise<boolean> {
  const variable = await homeyFetch<BetterLogicVariable>(
    `/api/app/${BETTER_LOGIC_APP}/${encodeURIComponent(name)}`,
  );
  return Boolean(variable.value);
}

function asFlowList(
  records: Record<string, HomeyFlowRecord> | HomeyFlowRecord[],
): HomeyFlowRecord[] {
  return Array.isArray(records) ? records : Object.values(records);
}

function toFlowSummaries(
  records: Record<string, HomeyFlowRecord> | HomeyFlowRecord[],
  kind: FlowKind,
): FlowSummary[] {
  return asFlowList(records)
    .filter((f) => f.enabled !== false)
    .map((f) => ({
      id: f.id,
      name: f.name,
      kind,
      triggerable: f.triggerable === true,
    }));
}

async function listGarageFlows(): Promise<FlowSummary[]> {
  const [classic, advanced] = await Promise.all([
    homeyFetch<Record<string, HomeyFlowRecord> | HomeyFlowRecord[]>(
      "/api/manager/flow/flow",
    ),
    homeyFetch<Record<string, HomeyFlowRecord> | HomeyFlowRecord[]>(
      "/api/manager/flow/advancedflow",
    ),
  ]);
  return [
    ...toFlowSummaries(classic, "flow"),
    ...toFlowSummaries(advanced, "advancedflow"),
  ];
}

function requireFlow(flows: FlowSummary[], name: string): FlowSummary {
  const exact = flows.find((f) => f.name === name);
  if (exact) return exact;
  const lowered = name.toLowerCase();
  const fuzzy = flows.find((f) => f.name.toLowerCase() === lowered);
  if (fuzzy) return fuzzy;
  throw new Error(`Homey flow not found: ${name}`);
}

async function triggerFlow(flow: FlowSummary): Promise<void> {
  const path =
    flow.kind === "advancedflow"
      ? `/api/manager/flow/advancedflow/${flow.id}/trigger`
      : `/api/manager/flow/flow/${flow.id}/trigger`;
  await homeyFetch(path, { method: "POST", body: "{}" });
}

/** Run a Homey flow card action (used when advanced flows are not triggerable). */
async function runFlowCardAction(
  cardId: string,
  args: Record<string, unknown> = {},
): Promise<void> {
  const lastColon = cardId.lastIndexOf(":");
  if (lastColon <= 0) {
    throw new Error(`Invalid Homey flow card id: ${cardId}`);
  }
  const ownerUri = cardId.slice(0, lastColon);
  const path = `/api/manager/flow/flowcardaction/${encodeURIComponent(ownerUri)}/${encodeURIComponent(cardId)}/run`;
  await homeyFetch(path, {
    method: "POST",
    body: JSON.stringify({ args }),
  });
}

/**
 * Start a named garage flow. Prefer Homey's /trigger when the flow is
 * triggerable (has a Start card). Otherwise run its action cards directly.
 */
async function runGarageFlow(flow: FlowSummary): Promise<void> {
  if (flow.triggerable) {
    await triggerFlow(flow);
    return;
  }

  if (flow.kind === "advancedflow") {
    const detailed = await homeyFetch<HomeyAdvancedFlow>(
      `/api/manager/flow/advancedflow/${flow.id}`,
    );
    const actions = Object.values(detailed.cards ?? {}).filter(
      (card) => card.type === "action" && typeof card.id === "string",
    );
    if (actions.length === 0) {
      throw new Error(
        `Homey flow "${flow.name}" has no action cards and is not triggerable`,
      );
    }
    for (const card of actions) {
      await runFlowCardAction(card.id, card.args ?? {});
    }
    return;
  }

  const detailed = await homeyFetch<HomeyClassicFlow>(
    `/api/manager/flow/flow/${flow.id}`,
  );
  const actions = detailed.actions ?? [];
  if (actions.length === 0) {
    throw new Error(
      `Homey flow "${flow.name}" has no actions and is not triggerable`,
    );
  }
  for (const action of actions) {
    const cardId = action.id.includes(":")
      ? action.id
      : `${action.uri ?? ""}:${action.id}`.replace(/^:/, "");
    await runFlowCardAction(cardId, action.args ?? {});
  }
}

export async function getGarageState(): Promise<GarageState> {
  const [open, flows] = await Promise.all([
    getBetterLogicBoolean(GARAGE_STATUS_VARIABLE),
    listGarageFlows(),
  ]);

  const openFlow = requireFlow(flows, OPEN_GARAGE_FLOW);
  const closeFlow = requireFlow(flows, CLOSE_GARAGE_FLOW);

  return {
    open,
    statusVariable: GARAGE_STATUS_VARIABLE,
    openFlowId: openFlow.id,
    closeFlowId: closeFlow.id,
    openFlowKind: openFlow.kind,
    closeFlowKind: closeFlow.kind,
    openFlowTriggerable: openFlow.triggerable,
    closeFlowTriggerable: closeFlow.triggerable,
  };
}

export async function setGarageOpen(open: boolean): Promise<GarageState> {
  const state = await getGarageState();
  const flow: FlowSummary = open
    ? {
        id: state.openFlowId,
        name: OPEN_GARAGE_FLOW,
        kind: state.openFlowKind,
        triggerable: state.openFlowTriggerable,
      }
    : {
        id: state.closeFlowId,
        name: CLOSE_GARAGE_FLOW,
        kind: state.closeFlowKind,
        triggerable: state.closeFlowTriggerable,
      };
  await runGarageFlow(flow);

  // Better Logic `isGarageOpen` typically updates after ~15–30s; return the real
  // variable value. The UI keeps an optimistic sticky position until it matches.
  return getGarageState();
}

type HomeyLocationOption = {
  latitude?: number;
  longitude?: number;
  lat?: number;
  lng?: number;
  accuracy?: number;
};

/** Homey's configured home coordinates (Settings → Location). */
export async function getHomeyLocation(): Promise<HomeCoords | null> {
  try {
    const loc = await homeyFetch<HomeyLocationOption | { value?: HomeyLocationOption }>(
      "/api/manager/geolocation/option/location",
    );
    const value =
      loc && typeof loc === "object" && "value" in loc && loc.value
        ? loc.value
        : (loc as HomeyLocationOption | undefined);
    if (!value || typeof value !== "object") return null;
    const lat = Number(value.latitude ?? value.lat);
    const lng = Number(value.longitude ?? value.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

setHomeyLocationFetcher(getHomeyLocation);
