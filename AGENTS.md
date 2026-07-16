# Homey dashboard — agent handoff

Next.js app controlling Homey Pro devices. Production: https://homey-gilt.vercel.app  
Repo: `tvlins-git/Homey` (deploys from `main` via Vercel).

## Architecture

- Browser → Next.js API routes (cookie auth) → Homey Web API
- Server-only env: `HOMEY_URL`, `HOMEY_TOKEN`, `DASHBOARD_PASSWORD` (never `NEXT_PUBLIC_*`)
- Homey cloud URL pattern: `https://<homeyId>.connect.athom.com`
- Auth: `src/lib/auth.ts` + `POST /api/login`
- Homey client: `src/lib/homey.ts`

## Features

### Living Room / Dining Room
- API: `GET|POST /api/rooms/[slug]` (`living-room`, `dining-room`)
- Master toggle + per-device on/off for lights/sockets
- Mixed state → master turns **all off**
- UI: `src/app/page.tsx` (`RoomCard`)

### Garage open/close slider (important)

**Purpose:** Third dashboard section; user slides to open or close the garage door.

**Homey devices (matched by exact name in `src/lib/homey.ts`):**
| Role | Homey device name | Capability |
| --- | --- | --- |
| Open action | `Open Garage Virtual` | `button` ← `PUT { "value": true }` |
| Close action | `Close Garage Virtual` | `button` ← `PUT { "value": true }` |
| Open/closed status | `Garage Door` | `alarm_motion` (true ≈ open) |

**Backend**
- `getGarageState()` / `setGarageOpen(open: boolean)` in [`src/lib/homey.ts`](src/lib/homey.ts)
- `GET|POST /api/garage` in [`src/app/api/garage/route.ts`](src/app/api/garage/route.ts)
- POST body: `{ "open": true }` or `{ "open": false }`
- After button press, sensor can lag; API returns requested `open` immediately

**Frontend slider** (`GarageCard` in [`src/app/page.tsx`](src/app/page.tsx))
- `<input type="range" min={0} max={100}>` — 0 = closed, 100 = open
- On release (`onPointerUp` / `onKeyUp`), `commit(value)`:
  - `value >= 65` → open (call API if not already open)
  - `value <= 35` → close (call API if not already closed)
  - else snap back to current state
- Styles: `.garage-slider` in [`src/app/globals.css`](src/app/globals.css)
- Polls with rooms every 5s via `load()`

**Extending the slider:** reuse the same snap-threshold pattern; keep open/close as separate Homey button devices unless a single cover/position capability appears.

## Local / deploy

```bash
cp .env.example .env.local   # fill HOMEY_URL, HOMEY_TOKEN, DASHBOARD_PASSWORD
npm install && npm run dev
npx vercel deploy --prod     # project linked as tvlins/homey
```

Do not put Homey secrets in git or client bundles. GitHub Pages is not suitable for this app.
