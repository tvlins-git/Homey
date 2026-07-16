# Homey home dashboard

Very simple Next.js dashboard for **Living Room** and **Dining Room** lights, plus **Flows** you can start from Homey. Homey credentials stay on the server — never in the browser bundle.

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

The room buttons toggle **lights** and **sockets** (not the TV). The **Flows** panel lists Homey flows marked triggerable (classic + advanced) and starts them via the Homey Flow API.

## What stays private

| Value | Where |
| --- | --- |
| `HOMEY_TOKEN` | Server env only |
| `HOMEY_URL` | Server env only |
| Browser | Calls `/api/living-room` on this app only |
