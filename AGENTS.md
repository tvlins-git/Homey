# Homey dashboard — agent handoff

Next.js app controlling Homey Pro devices. Production: https://homey-gilt.vercel.app  
Repo: `tvlins-git/Homey` (deploys from `main` via Vercel).

## Architecture

- Browser → Next.js API routes (cookie auth) → Homey Web API
- Server-only env: `HOMEY_URL`, `HOMEY_TOKEN`, `DASHBOARD_PASSWORD` (never `NEXT_PUBLIC_*`)
- Homey cloud URL: `https://65f2e959051ba009ec117757.connect.athom.com` (pattern `https://<homeyId>.connect.athom.com`)
- Auth: [`src/lib/auth.ts`](src/lib/auth.ts) + `POST /api/login`
- Homey client: [`src/lib/homey.ts`](src/lib/homey.ts)
- Room registry: [`src/lib/rooms.ts`](src/lib/rooms.ts) (`ROOM_NAMES` / `ROOMS`)

## Current UI

- Garage slider **above** Living Room (open/close via Homey flows)
- Multi-room light dashboard (Living Room, Dining Room, Master Bedroom, Maria room, Ellie room, Backyard, Frontyard)
- API: `GET|POST /api/rooms/[slug]`
- Master toggle + per-device on/off for `light` / `socket` with `onoff`
- Mixed device state → master turns **all off**
- Compact mobile layout in [`src/app/page.tsx`](src/app/page.tsx) + [`src/app/globals.css`](src/app/globals.css)

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

- Route: `GET|POST /api/garage` (auth required)
- POST body: `{ "open": true | false }`
- Files: `src/lib/homey.ts`, `src/app/api/garage/route.ts`, `GarageCard` in `src/app/page.tsx`, `.garage-slider` in `src/app/globals.css`

### Frontend slider behavior

- Placed **above Living Room** (`grid-column: 1 / -1`)
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
cp .env.example .env.local   # HOMEY_URL, HOMEY_TOKEN, DASHBOARD_PASSWORD
npm install && npm run dev
npx vercel deploy --prod     # project: tvlins/homey
```

Never commit secrets. Do not use GitHub Pages for this app.
