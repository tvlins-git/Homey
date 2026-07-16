"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type RoomSlug = "living-room" | "dining-room";

type RoomState = {
  slug: RoomSlug;
  zoneName: string;
  on: boolean;
  mixed: boolean;
  devices: { id: string; name: string; class: string; on: boolean }[];
};

type GarageState = {
  open: boolean;
  sensorName: string;
};

const ROOMS: { slug: RoomSlug; title: string }[] = [
  { slug: "living-room", title: "Living Room" },
  { slug: "dining-room", title: "Dining Room" },
];

function RoomCard({
  title,
  state,
  busy,
  busyDeviceId,
  onToggleMaster,
  onToggleDevice,
}: {
  title: string;
  state: RoomState | null;
  busy: boolean;
  busyDeviceId: string | null;
  onToggleMaster: () => void;
  onToggleDevice: (deviceId: string, currentlyOn: boolean) => void;
}) {
  const masterLabel = state?.mixed ? "Mixed" : state?.on ? "On" : "Off";
  const masterClass = state?.mixed
    ? "is-mixed"
    : state?.on
      ? "is-on"
      : "is-off";

  return (
    <section className="panel room">
      <div className="room-head">
        <div className="room-title">
          <h2>{title}</h2>
          <p className="room-meta">
            {busy
              ? "Updating…"
              : state?.mixed
                ? "Mixed · tap for all off"
                : state
                  ? `${state.devices.filter((d) => d.on).length}/${state.devices.length} on`
                  : "Loading…"}
          </p>
        </div>
        <button
          className={`power ${masterClass}`}
          type="button"
          onClick={onToggleMaster}
          disabled={!state || busy}
          aria-label={`Toggle all ${title} lights`}
          aria-pressed={state?.on ?? false}
        >
          <span className="power-label">{masterLabel}</span>
        </button>
      </div>

      {state && (
        <ul className="devices">
          {state.devices.map((d) => (
            <li key={d.id}>
              <span>{d.name}</span>
              <button
                type="button"
                className={d.on ? "dot on" : "dot"}
                aria-label={`Turn ${d.name} ${d.on ? "off" : "on"}`}
                aria-pressed={d.on}
                disabled={busy || busyDeviceId !== null}
                onClick={() => onToggleDevice(d.id, d.on)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GarageCard({
  state,
  busy,
  onSetOpen,
}: {
  state: GarageState | null;
  busy: boolean;
  onSetOpen: (open: boolean) => void;
}) {
  const [slider, setSlider] = useState(0);

  useEffect(() => {
    if (state) setSlider(state.open ? 100 : 0);
  }, [state]);

  function commit(value: number) {
    if (!state || busy) {
      setSlider(state?.open ? 100 : 0);
      return;
    }
    if (value >= 65) {
      setSlider(100);
      if (!state.open) onSetOpen(true);
      return;
    }
    if (value <= 35) {
      setSlider(0);
      if (state.open) onSetOpen(false);
      return;
    }
    setSlider(state.open ? 100 : 0);
  }

  return (
    <section className="panel garage">
      <div className="room-head">
        <div className="room-title">
          <h2>Garage</h2>
          <p className="room-meta">
            {busy
              ? "Sending…"
              : state
                ? state.open
                  ? "Open · slide left to close"
                  : "Closed · slide right to open"
                : "Loading…"}
          </p>
        </div>
        <span className={`garage-badge ${state?.open ? "is-open" : "is-closed"}`}>
          {state?.open ? "Open" : "Closed"}
        </span>
      </div>

      <div className="garage-slider">
        <span className="garage-end">Close</span>
        <input
          type="range"
          min={0}
          max={100}
          value={slider}
          disabled={!state || busy}
          aria-label="Garage door"
          onChange={(e) => setSlider(Number(e.target.value))}
          onPointerUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
          onKeyUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
        />
        <span className="garage-end">Open</span>
      </div>
    </section>
  );
}

export default function Home() {
  const [needsLogin, setNeedsLogin] = useState(false);
  const [password, setPassword] = useState("");
  const [rooms, setRooms] = useState<Partial<Record<RoomSlug, RoomState>>>({});
  const [garage, setGarage] = useState<GarageState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<RoomSlug | null>(null);
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null);
  const [garageBusy, setGarageBusy] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const [roomResults, garageRes] = await Promise.all([
      Promise.all(
        ROOMS.map(async ({ slug }) => {
          const res = await fetch(`/api/rooms/${slug}`);
          return { slug, res, data: await res.json() };
        }),
      ),
      fetch("/api/garage"),
    ]);
    const garageData = await garageRes.json();

    if (
      roomResults.some((r) => r.res.status === 401) ||
      garageRes.status === 401
    ) {
      setNeedsLogin(true);
      setRooms({});
      setGarage(null);
      return;
    }

    const next: Partial<Record<RoomSlug, RoomState>> = {};
    for (const { slug, res, data } of roomResults) {
      if (!res.ok) {
        setError(data.error ?? `Failed to load ${slug}`);
        continue;
      }
      next[slug] = data;
    }
    if (!garageRes.ok) {
      setError(garageData.error ?? "Failed to load Garage");
    } else {
      setGarage(garageData);
    }
    setNeedsLogin(false);
    setRooms(next);
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [load]);

  async function login(e: FormEvent) {
    e.preventDefault();
    setLoginBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Login failed");
        return;
      }
      setPassword("");
      await load();
    } finally {
      setLoginBusy(false);
    }
  }

  async function toggleMaster(slug: RoomSlug) {
    const state = rooms[slug];
    if (!state || busySlug) return;
    const nextOn = state.mixed || state.on ? false : true;
    setBusySlug(slug);
    setError(null);
    try {
      const res = await fetch(`/api/rooms/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: nextOn }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Toggle failed");
        return;
      }
      setRooms((prev) => ({ ...prev, [slug]: data }));
    } finally {
      setBusySlug(null);
    }
  }

  async function toggleDevice(
    slug: RoomSlug,
    deviceId: string,
    currentlyOn: boolean,
  ) {
    if (busySlug || busyDeviceId) return;
    setBusyDeviceId(deviceId);
    setError(null);
    try {
      const res = await fetch(`/api/rooms/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, on: !currentlyOn }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Device toggle failed");
        return;
      }
      setRooms((prev) => ({ ...prev, [slug]: data }));
    } finally {
      setBusyDeviceId(null);
    }
  }

  async function setGarageOpen(open: boolean) {
    if (garageBusy) return;
    setGarageBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/garage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ open }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Garage command failed");
        await load();
        return;
      }
      setGarage(data);
    } finally {
      setGarageBusy(false);
    }
  }

  return (
    <main className="page">
      <div className="glow" aria-hidden />
      <div className="shell">
        <header className="hero">
          <p className="brand">Homey</p>
          <h1>Home</h1>
        </header>

        {needsLogin ? (
          <section className="panel">
            <form className="login" onSubmit={login}>
              <input
                type="password"
                placeholder="Dashboard password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button type="submit" disabled={loginBusy || !password}>
                Unlock
              </button>
            </form>
          </section>
        ) : (
          <div className="rooms">
            {ROOMS.map(({ slug, title }) => (
              <RoomCard
                key={slug}
                title={title}
                state={rooms[slug] ?? null}
                busy={busySlug === slug}
                busyDeviceId={busyDeviceId}
                onToggleMaster={() => void toggleMaster(slug)}
                onToggleDevice={(deviceId, currentlyOn) =>
                  void toggleDevice(slug, deviceId, currentlyOn)
                }
              />
            ))}
            <GarageCard
              state={garage}
              busy={garageBusy}
              onSetOpen={(open) => void setGarageOpen(open)}
            />
          </div>
        )}

        {error && <p className="error">{error}</p>}
      </div>
    </main>
  );
}
