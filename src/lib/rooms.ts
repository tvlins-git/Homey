export const ROOM_NAMES = {
  "living-room": "Living Room",
  "dining-room": "Dining Room",
  "master-bedroom": "Master Bedroom",
  "maria-room": "Maria Room",
  "ellie-room": "Ellie Room",
  backyard: "Backyard",
  "front-yard": "Frontyard",
} as const;

export type RoomSlug = keyof typeof ROOM_NAMES;

export const ROOMS: { slug: RoomSlug; title: string }[] = (
  Object.entries(ROOM_NAMES) as [RoomSlug, string][]
).map(([slug, title]) => ({ slug, title }));
