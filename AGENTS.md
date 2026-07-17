# Homey dashboard — agent handoff

Next.js app controlling Homey Pro devices. Production: https://homey-gilt.vercel.app  
Repo: `tvlins-git/Homey` (deploys from `main` via Vercel).

## Architecture

- Browser → Next.js API routes (cookie auth) → Homey Web API
- Server-only env: `HOMEY_URL`, `HOMEY_TOKEN`, `ADMIN_PASSWORD` / `DASHBOARD_PASSWORD`, home + KV vars (never `NEXT_PUBLIC_*`)
- Homey cloud URL: `https://65f2e959051ba009ec117757.connect.athom.com` (pattern `https://<homeyId>.connect.athom.com`)
- Auth: [`src/lib/auth.ts`](src/lib/auth.ts) + `POST /api/login` (username/password; multi-user)
- Users/ACL: [`src/lib/users.ts`](src/lib/users.ts) (Upstash Redis, in-memory fallback)
- Home detection: [`src/lib/home.ts`](src/lib/home.ts) — WAN IP allowlist + optional geofence
- Homey client: [`src/lib/homey.ts`](src/lib/homey.ts)
- Room registry: [`src/lib/rooms.ts`](src/lib/rooms.ts) (`ROOM_NAMES` / `ROOMS`)
- Groups (rooms + garage): [`src/lib/groups.ts`](src/lib/groups.ts)

## Current UI

- Multi-user login; admin panel for per-group access (`always` / `home` / `never`)
- Password updates: any user can change their own (`PATCH /api/me`); admins can reset any user (`PATCH /api/admin/users` with `password`)
- Dashboard shows only groups the current user may control given home/away
- Garage slider **above** Living Room (open/close via Homey flows)
- Multi-room light dashboard (Living Room, Dining Room, Master Bedroom, Maria room, Ellie room, Backyard, Frontyard)
- API: `GET|POST /api/rooms/[slug]`, `GET|POST /api/garage`, `GET/POST /api/home`, `GET/POST/PATCH /api/me`, `GET/POST/PATCH/DELETE /api/admin/users`
- Master toggle + per-device on/off for `light` / `socket` with `onoff`
- Mixed device state → master turns **all off**
- Compact mobile layout in [`src/app/page.tsx`](src/app/page.tsx) + [`src/app/globals.css`](src/app/globals.css)

## Home detection (IP + geo)

**Home** = client public IP ∈ `HOME_WAN_IPS` (exact or CIDR) **OR** coords within `HOME_RADIUS_M` of the geofence center.

Geofence center (first match):
1. `HOME_LAT` / `HOME_LNG` env
2. Homey Settings → Location (`GET /api/manager/geolocation/option/location`)

Default radius is **50 m** (`HOME_RADIUS_M`).

Refresh cadence (browser tab open):
- Dashboard state (rooms/garage/me): every **5 s** (reuses last GPS fix)
- GPS / geofence coords: every **60 s** (or immediately via **Share location**)

- If neither IP nor geofence is available → home check **disabled** (`home: true`) so local/dev is not bricked
- iOS Safari: no WiFi/SSID APIs. **iCloud Private Relay** (`2a09:bac3:…`) hides the home WAN IP even on home Wi‑Fi — IP match fails and the UI prompts for **Share location**
- Routes: `GET|POST /api/home`; GETs may use `?lat=&lng=`; control POSTs may include `{ lat, lng }`
- Response includes `clientIp`, `proxied`, `geoConfigured`, `radiusM` for debugging
- Note: if `reason` is `ip`, leaving the house while still on home WAN (or a matching IP) stays **Home** until the IP no longer matches — geo is only used when IP does not match

## Multi-user ACL

Per user, per group (`garage` + room slugs), one mode:

| Mode | Meaning |
| --- | --- |
| `always` | Control when home and away |
| `home` | Control only when home |
| `never` | No access (default for new users) |

- Seed admin from `ADMIN_USERNAME` + `ADMIN_PASSWORD` (or legacy `DASHBOARD_PASSWORD`) — seed runs only when the user store is empty; changing the env password later does **not** update existing hashes
- Admin gets all groups `always` and can manage users in the UI (including Set password)
- Persist users in Upstash (`KV_REST_API_URL` / `KV_REST_API_TOKEN`); in-memory if unset (dev only)

## Garage open/close slider

### Homey flows / status (lookup by exact name)

| Role | Name | How |
| --- | --- | --- |
| Open | Advanced flow `Open Garage` | `POST …/advancedflow/:id/trigger` (Start card → `triggerable: true`) |
| Close | Advanced flow `Close Garage` | same |
| Status | Better Logic `isGarageOpen` | `GET /api/app/net.i-dev.betterlogic/isGarageOpen` — `true` = open, `false` = closed (updates ~15–30s after command) |

Lookup is by exact name among enabled flows. If a flow ever loses its Start card (`triggerable: false`), the dashboard falls back to running that flow’s action cards via `flowcardaction/.../run`.

### Backend

```ts
// getGarageState(): { open, statusVariable, openFlowId, closeFlowId, ... }
// setGarageOpen(open: boolean): trigger Open Garage or Close Garage flow, return state
```

- Route: `GET|POST /api/garage` (auth + ACL required)
- POST body: `{ "open": true | false, "lat"?: number, "lng"?: number }`
- Files: `src/lib/homey.ts`, `src/app/api/garage/route.ts`, `GarageCard` in `src/app/page.tsx`, `.garage-slider` in `src/app/globals.css`

### Frontend slider behavior

- Placed **above Living Room** (`grid-column: 1 / -1`) when ACL allows
- Default position from Better Logic `isGarageOpen`
- `<input type="range" min={0} max={100}>` — `0` closed, `100` open
- Local state follows drag; on **release** (`onPointerUp` / `onKeyUp`):
  - `value >= 65` → call API open (if not already open/opening), snap to 100, show Opening until `isGarageOpen` becomes true
  - `value <= 35` → call API close (if not already closed/closing), snap to 0, show Closing until `isGarageOpen` becomes false
  - else snap back to the sticky commanded position
- After command, keep slider + badge at that side until `isGarageOpen` matches (often 15–30s). Pending state lives in the parent and ignores variable flicker for at least 15s before clearing.
- Labels: Close (left) / Open (right); badge shows Open / Opening / Closed / Closing

### Safety

- Do not fire open/close while probing APIs unless intentional
- After testing open, always send close if the door should not stay open

## Local / deploy

```bash
cp .env.example .env.local   # HOMEY_URL, HOMEY_TOKEN, ADMIN_PASSWORD, optional HOME_* / KV_*
npm install && npm run dev
npx vercel deploy --prod     # project: tvlins/homey
```

Never commit secrets. Do not use GitHub Pages for this app.
