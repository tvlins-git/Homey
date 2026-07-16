"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type LivingRoomState = {
  zoneName: string;
  on: boolean;
  devices: { id: string; name: string; class: string; on: boolean }[];
};

export default function Home() {
  const [needsLogin, setNeedsLogin] = useState(false);
  const [password, setPassword] = useState("");
  const [state, setState] = useState<LivingRoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  async function toggle() {
    if (!state || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/living-room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: !state.on }),
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

  return (
    <main className="page">
      <div className="glow" aria-hidden />
      <section className="panel">
        <p className="brand">Homey</p>
        <h1>Living Room</h1>
        <p className="sub">One switch for the room lights</p>

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
              className={`power ${state?.on ? "is-on" : "is-off"}`}
              type="button"
              onClick={() => void toggle()}
              disabled={!state || busy}
              aria-pressed={state?.on ?? false}
            >
              <span className="power-label">{state?.on ? "On" : "Off"}</span>
              <span className="power-hint">
                {busy ? "Updating…" : state ? "Tap to toggle" : "Loading…"}
              </span>
            </button>

            {state && (
              <ul className="devices">
                {state.devices.map((d) => (
                  <li key={d.id}>
                    <span>{d.name}</span>
                    <span className={d.on ? "dot on" : "dot"} />
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
