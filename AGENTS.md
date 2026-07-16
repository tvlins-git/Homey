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

### Homey flows / sensor (lookup by exact name)

| Role | Name | How |
| --- | --- | --- |
| Open | Advanced flow `Open Garage` | If `triggerable`, `POST …/advancedflow/:id/trigger`. Otherwise run its action cards (currently Gogogate `open-door` door 1) via `POST …/flowcardaction/:uri/:id/run`. |
| Close | Advanced flow `Close Garage` | Same pattern (`close-door` door 1). |
| Status | Device `Garage Door` | read `alarm_motion` (true ≈ open; sensor can lag after command) |

These flows exist but are **not** marked `triggerable` (no Start / “This Flow is started” card). The dashboard still runs them by executing their action cards.

### Backend

```ts
// getGarageState(): { open, sensorName, openFlowId, closeFlowId, openFlowKind, closeFlowKind }
// setGarageOpen(open: boolean): trigger Open Garage or Close Garage flow, return state
```

- Route: `GET|POST /api/garage` (auth required)
- POST body: `{ "open": true | false }`
- Files: `src/lib/homey.ts`, `src/app/api/garage/route.ts`, `GarageCard` in `src/app/page.tsx`, `.garage-slider` in `src/app/globals.css`

### Frontend slider behavior

- Placed **above Living Room** (`grid-column: 1 / -1`)
- `<input type="range" min={0} max={100}>` — `0` closed, `100` open
- Local state follows drag; on **release** (`onPointerUp` / `onKeyUp`):
  - `value >= 65` → call API open (if not already open), snap to 100
  - `value <= 35` → call API close (if not already closed), snap to 0
  - else snap back to current Homey/sensor state
- Labels: Close (left) / Open (right); badge shows Open/Closed

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
