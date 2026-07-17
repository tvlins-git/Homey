import type { AccessMode } from "@/lib/acl";
import { ROOM_NAMES, ROOMS, type RoomSlug } from "@/lib/rooms";

export type GroupId = RoomSlug | "garage";

export const GROUPS: { id: GroupId; title: string }[] = [
  { id: "garage", title: "Garage" },
  ...ROOMS.map(({ slug, title }) => ({ id: slug as GroupId, title })),
];

export const GROUP_IDS: GroupId[] = GROUPS.map((g) => g.id);

export function isGroupId(value: string): value is GroupId {
  return GROUP_IDS.includes(value as GroupId);
}

export function groupTitle(id: GroupId): string {
  if (id === "garage") return "Garage";
  return ROOM_NAMES[id];
}

export function emptyAcl(): Record<GroupId, AccessMode> {
  const acl = {} as Record<GroupId, AccessMode>;
  for (const id of GROUP_IDS) {
    acl[id] = "never";
  }
  return acl;
}

export function alwaysAcl(): Record<GroupId, AccessMode> {
  const acl = {} as Record<GroupId, AccessMode>;
  for (const id of GROUP_IDS) {
    acl[id] = "always";
  }
  return acl;
}
