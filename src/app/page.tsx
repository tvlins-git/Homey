"use client";

import { FormEvent, useCallback, useEffect, useId, useState } from "react";
import { ROOMS, type RoomSlug } from "@/lib/rooms";

type RoomState = {
  slug: RoomSlug;
  zoneName: string;
  on: boolean;
  mixed: boolean;
  devices: { id: string; name: string; class: string; on: boolean }[];
};

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
  const [open, setOpen] = useState(false);
  const devicesId = useId();
  const masterLabel = state?.mixed ? "Mixed" : state?.on ? "On" : "Off";
  const masterClass = state?.mixed
    ? "is-mixed"
    : state?.on
      ? "is-on"
      : "is-off";
  const deviceCount = state?.devices.length ?? 0;

  return (
    <section className={`panel room${open ? " is-open" : ""}`}>
      <div className="room-head">
        <button
          type="button"
          className="room-toggle"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={devicesId}
          disabled={!state || deviceCount === 0}
        >
          <div className="room-title">
            <h2>
              {title}
              <span className="chevron" aria-hidden>
                ▾
              </span>
            </h2>
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
        </button>
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

      {state && deviceCount > 0 && (
        <ul
          id={devicesId}
          className="devices"
          hidden={!open}
        >
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

export default function Home() {
  const [needsLogin, setNeedsLogin] = useState(false);
  const [password, setPassword] = useState("");
  const [rooms, setRooms] = useState<Partial<Record<RoomSlug, RoomState>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<RoomSlug | null>(null);
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null);
  const [homeBusy, setHomeBusy] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);

  const loadedRooms = ROOMS.map(({ slug }) => rooms[slug]).filter(
    (room): room is RoomState => Boolean(room),
  );
  const anyRoomOn = loadedRooms.some((room) => room.on || room.mixed);
  const allRoomsOn =
    loadedRooms.length > 0 && loadedRooms.every((room) => room.on && !room.mixed);
  const roomsReady = loadedRooms.length === ROOMS.length;

  const load = useCallback(async () => {
    setError(null);
    const roomResults = await Promise.all(
      ROOMS.map(async ({ slug }) => {
        const res = await fetch(`/api/rooms/${slug}`);
        return { slug, res, data: await res.json() };
      }),
    );

    if (roomResults.some((r) => r.res.status === 401)) {
      setNeedsLogin(true);
      setRooms({});
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
    if (!state || busySlug || homeBusy) return;
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

  async function setAllRoomsPower(on: boolean) {
    if (!roomsReady || homeBusy || busySlug || busyDeviceId) return;
    setHomeBusy(true);
    setError(null);
    try {
      const results = await Promise.all(
        ROOMS.map(async ({ slug }) => {
          const res = await fetch(`/api/rooms/${slug}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ on }),
          });
          return { slug, res, data: await res.json() };
        }),
      );

      const next: Partial<Record<RoomSlug, RoomState>> = { ...rooms };
      for (const { slug, res, data } of results) {
        if (!res.ok) {
          setError(data.error ?? "Home toggle failed");
          continue;
        }
        next[slug] = data;
      }
      setRooms(next);
    } finally {
      setHomeBusy(false);
    }
  }

  async function toggleDevice(
    slug: RoomSlug,
    deviceId: string,
    currentlyOn: boolean,
  ) {
    if (busySlug || busyDeviceId || homeBusy) return;
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
          <>
            <section className="home-master" aria-label="All rooms">
              <span className="home-master-label">
                {homeBusy
                  ? "Updating…"
                  : !roomsReady
                    ? "Loading…"
                    : allRoomsOn
                      ? "All on"
                      : anyRoomOn
                        ? "Mixed"
                        : "All off"}
              </span>
              <div className="home-master-actions">
                <button
                  type="button"
                  className={`home-power${allRoomsOn ? " is-active" : ""}`}
                  disabled={
                    !roomsReady || homeBusy || busySlug !== null || allRoomsOn
                  }
                  onClick={() => void setAllRoomsPower(true)}
                >
                  On
                </button>
                <button
                  type="button"
                  className={`home-power${
                    roomsReady && !anyRoomOn ? " is-active" : ""
                  }`}
                  disabled={
                    !roomsReady || homeBusy || busySlug !== null || !anyRoomOn
                  }
                  onClick={() => void setAllRoomsPower(false)}
                >
                  Off
                </button>
              </div>
            </section>

            <div className="rooms">
              {ROOMS.map(({ slug, title }) => (
                <RoomCard
                  key={slug}
                  title={title}
                  state={rooms[slug] ?? null}
                  busy={busySlug === slug || homeBusy}
                  busyDeviceId={busyDeviceId}
                  onToggleMaster={() => void toggleMaster(slug)}
                  onToggleDevice={(deviceId, currentlyOn) =>
                    void toggleDevice(slug, deviceId, currentlyOn)
                  }
                />
              ))}
            </div>
          </>
        )}

        {error && <p className="error">{error}</p>}
      </div>
    </main>
  );
}
