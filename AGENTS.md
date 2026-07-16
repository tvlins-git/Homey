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

## Current UI (as of latest main)

- Multi-room light dashboard (Living Room, Dining Room, Master Bedroom, Maria Room, Ellie Room, Backyard, Front Yard)
- API: `GET|POST /api/rooms/[slug]`
- Master toggle + per-device on/off for `light` / `socket` with `onoff`
- Mixed device state → master turns **all off**
- Compact mobile layout in [`src/app/page.tsx`](src/app/page.tsx) + [`src/app/globals.css`](src/app/globals.css)

**Note:** Garage slider was built earlier in this project lineage but is **not currently on `main`** (removed in a later rooms expansion). Re-add using the recipe below.

## Garage open/close slider (reuse this)

### Homey devices (lookup by exact name)

| Role | Device name | Capability / call |
| --- | --- | --- |
| Open | `Open Garage Virtual` | `PUT /api/manager/devices/device/:id/capability/button` body `{"value":true}` |
| Close | `Close Garage Virtual` | same `button` capability |
| Status | `Garage Door` | read `alarm_motion` (true ≈ open; sensor can lag after command) |

Known IDs from last working integration (prefer name lookup; IDs may change if re-paired):
- Open: `b8672c5b-683c-44af-9ab2-7b62a1e136d8`
- Close: `c3d0b863-5e6e-4794-8407-6312befef44c`
- Sensor: `75db5be7-af06-4a12-a7e2-94f6bfea048e`

### Backend pattern to restore

```ts
// getGarageState(): { open, openDeviceId, closeDeviceId, sensorName }
// setGarageOpen(open: boolean): press Open or Close virtual button, return state
```

- Route: `GET|POST /api/garage` (auth required)
- POST body: `{ "open": true | false }`

Reference commit that had the full implementation: `116de6c` / PR #5 (`cursor/garage-slider-4930`), files:
- `src/lib/homey.ts` — `getGarageState`, `setGarageOpen`
- `src/app/api/garage/route.ts`
- `GarageCard` in `src/app/page.tsx`
- `.garage-slider` styles in `src/app/globals.css`

### Frontend slider behavior

- `<input type="range" min={0} max={100}>` — `0` closed, `100` open
- Local state follows drag; on **release** (`onPointerUp` / `onKeyUp`):
  - `value >= 65` → call API open (if not already open), snap to 100
  - `value <= 35` → call API close (if not already closed), snap to 0
  - else snap back to current Homey/sensor state
- Labels: Close (left) / Open (right); badge shows Open/Closed
- Keep section compact for mobile (`grid-column: 1 / -1` under room cards)

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
