"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type LivingRoomState = {
  zoneName: string;
  on: boolean;
  mixed: boolean;
  devices: { id: string; name: string; class: string; on: boolean }[];
};

export default function Home() {
  const [needsLogin, setNeedsLogin] = useState(false);
  const [password, setPassword] = useState("");
  const [state, setState] = useState<LivingRoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/living-room");
    if (res.status === 401) {
      setNeedsLogin(true);
      setState(null);
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to load Living Room");
      return;
    }
    setNeedsLogin(false);
    setState(data);
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [load]);

  async function login(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
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
      setBusy(false);
    }
  }

  async function toggleMaster() {
    if (!state || busy) return;
    // Mixed or all-on → turn everything off; all-off → turn everything on
    const nextOn = state.mixed || state.on ? false : true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/living-room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: nextOn }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Toggle failed");
        return;
      }
      setState(data);
    } finally {
      setBusy(false);
    }
  }

  async function toggleDevice(deviceId: string, currentlyOn: boolean) {
    if (busy || busyDeviceId) return;
    setBusyDeviceId(deviceId);
    setError(null);
    try {
      const res = await fetch("/api/living-room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, on: !currentlyOn }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Device toggle failed");
        return;
      }
      setState(data);
    } finally {
      setBusyDeviceId(null);
    }
  }

  const masterLabel = state?.mixed ? "Mixed" : state?.on ? "On" : "Off";
  const masterClass = state?.mixed
    ? "is-mixed"
    : state?.on
      ? "is-on"
      : "is-off";

  return (
    <main className="page">
      <div className="glow" aria-hidden />
      <section className="panel">
        <p className="brand">Homey</p>
        <h1>Living Room</h1>
        <p className="sub">Room master + individual lights</p>

        {needsLogin ? (
          <form className="login" onSubmit={login}>
            <input
              type="password"
              placeholder="Dashboard password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <button type="submit" disabled={busy || !password}>
              Unlock
            </button>
          </form>
        ) : (
          <>
            <button
              className={`power ${masterClass}`}
              type="button"
              onClick={() => void toggleMaster()}
              disabled={!state || busy}
              aria-pressed={state?.on ?? false}
            >
              <span className="power-label">{masterLabel}</span>
              <span className="power-hint">
                {busy
                  ? "Updating…"
                  : state?.mixed
                    ? "Tap to turn all off"
                    : state
                      ? "Tap to toggle all"
                      : "Loading…"}
              </span>
            </button>

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
                      onClick={() => void toggleDevice(d.id, d.on)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {error && <p className="error">{error}</p>}
      </section>
    </main>
  );
}
