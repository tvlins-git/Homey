# Homey Living Room dashboard

Very simple Next.js dashboard for home lights across Living Room, Dining Room, Master Bedroom, Maria room, Ellie room, Backyard, and Frontyard. Homey credentials stay on the server — never in the browser bundle.

## Secrets (do not commit)

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Set:

- `HOMEY_URL` — e.g. `https://YOUR_ID.connect.athom.com`
- `HOMEY_TOKEN` — Homey Pro API key (Settings → API Keys)
- `DASHBOARD_PASSWORD` — password to unlock the UI / API

On Vercel (or similar), add the same values under **Environment Variables**. Do **not** use GitHub Pages for this app — static hosting cannot keep the API key secret.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), enter the dashboard password, then tap the Living Room button.

The button toggles Living Room **lights** and **sockets** (not the TV).

## What stays private

| Value | Where |
| --- | --- |
| `HOMEY_TOKEN` | Server env only |
| `HOMEY_URL` | Server env only |
| Browser | Calls `/api/living-room` on this app only |
