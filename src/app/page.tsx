"use client";

import { FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { ACCESS_MODES, type AccessMode } from "@/lib/acl";
import { GROUPS, type GroupId } from "@/lib/groups";
import { ROOMS, type RoomSlug } from "@/lib/rooms";
import { APP_VERSION } from "@/lib/version";

type RoomState = {
  slug: RoomSlug;
  zoneName: string;
  on: boolean;
  mixed: boolean;
  devices: { id: string; name: string; class: string; on: boolean }[];
};

type GarageState = {
  open: boolean;
  statusVariable: string;
};

type HomeCoords = { lat: number; lng: number };

type HomeInfo = {
  home: boolean;
  reason: string;
  geoConfigured?: boolean;
  configured?: boolean;
  clientIp?: string | null;
  proxied?: boolean;
  radiusM?: number | null;
};

const COORDS_STORAGE_KEY = "homey_home_coords";
/** How often to re-read GPS while the dashboard is open. */
const GEO_REFRESH_MS = 60_000;
/** Dashboard room/garage poll interval (reuses last GPS between refreshes). */
const DASHBOARD_POLL_MS = 5_000;

type StoredCoords = HomeCoords & { at: number };

function readStoredCoords(): StoredCoords | null {
  try {
    const raw = sessionStorage.getItem(COORDS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredCoords>;
    if (
      typeof parsed?.lat === "number" &&
      typeof parsed?.lng === "number" &&
      Number.isFinite(parsed.lat) &&
      Number.isFinite(parsed.lng)
    ) {
      return {
        lat: parsed.lat,
        lng: parsed.lng,
        at: typeof parsed.at === "number" ? parsed.at : 0,
      };
    }
  } catch {
    // ignore
  }
  return null;
}

function storeCoords(pos: HomeCoords | null) {
  try {
    if (!pos) {
      sessionStorage.removeItem(COORDS_STORAGE_KEY);
      return;
    }
    const payload: StoredCoords = { ...pos, at: Date.now() };
    sessionStorage.setItem(COORDS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

type MeUser = {
  id: string;
  username: string;
  role: "admin" | "user";
};

type AllowedGroup = { id: GroupId; title: string; mode: AccessMode };

type AdminUserRow = {
  user: MeUser;
  acl: Record<GroupId, AccessMode>;
};

function getGeolocation(forceFresh = false): Promise<HomeCoords | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        }),
      () => resolve(null),
      {
        enableHighAccuracy: true,
        timeout: 12_000,
        // Prefer a fresh fix when refreshing; allow a short cache otherwise.
        maximumAge: forceFresh ? 0 : 15_000,
      },
    );
  });
}

function withCoordsPath(path: string, pos: HomeCoords | null | undefined): string {
  if (!pos) return path;
  const join = path.includes("?") ? "&" : "?";
  return `${path}${join}lat=${encodeURIComponent(String(pos.lat))}&lng=${encodeURIComponent(String(pos.lng))}`;
}

function GarageCard({
  displayOpen,
  pending,
  busy,
  locked,
  onSetOpen,
}: {
  displayOpen: boolean;
  pending: boolean;
  busy: boolean;
  locked: boolean;
  onSetOpen: (open: boolean) => void;
}) {
  const [slider, setSlider] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) setSlider(displayOpen ? 100 : 0);
  }, [displayOpen, dragging]);

  function commit(value: number) {
    setDragging(false);
    if (busy || locked) {
      setSlider(displayOpen ? 100 : 0);
      return;
    }
    if (value >= 65) {
      setSlider(100);
      if (!displayOpen) onSetOpen(true);
      return;
    }
    if (value <= 35) {
      setSlider(0);
      if (displayOpen) onSetOpen(false);
      return;
    }
    setSlider(displayOpen ? 100 : 0);
  }

  const badgeLabel = pending
    ? displayOpen
      ? "Opening"
      : "Closing"
    : displayOpen
      ? "Open"
      : "Closed";

  const metaLabel = locked
    ? "Available at home"
    : busy
      ? "Sending…"
      : pending
        ? displayOpen
          ? "Opening… waiting for Homey"
          : "Closing… waiting for Homey"
        : displayOpen
          ? "Open · slide left to close"
          : "Closed · slide right to open";

  return (
    <section className="panel garage">
      <div className="room-head">
        <div className="room-title">
          <h2>Garage</h2>
          <p className="room-meta">{metaLabel}</p>
        </div>
        <span
          className={`garage-badge ${displayOpen ? "is-open" : "is-closed"}`}
        >
          {badgeLabel}
        </span>
      </div>

      <div className="garage-slider">
        <span className="garage-end">Close</span>
        <input
          type="range"
          min={0}
          max={100}
          value={slider}
          disabled={busy || locked}
          aria-label="Garage door"
          onChange={(e) => {
            setDragging(true);
            setSlider(Number(e.target.value));
          }}
          onPointerDown={() => setDragging(true)}
          onPointerUp={(e) =>
            commit(Number((e.target as HTMLInputElement).value))
          }
          onKeyUp={(e) =>
            commit(Number((e.target as HTMLInputElement).value))
          }
        />
        <span className="garage-end">Open</span>
      </div>
    </section>
  );
}

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
  const masterLabel = state?.mixed ? "All" : state?.on ? "On" : "Off";
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
                  ? "All · tap for all off"
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
        <ul id={devicesId} className="devices" hidden={!open}>
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

function AccountPanel() {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Password update failed");
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setOk("Password updated");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel admin-panel">
      <button
        type="button"
        className="admin-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <h2>Change password</h2>
        <span className="chevron" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="admin-body">
          <form className="admin-create" onSubmit={changePassword}>
            <input
              type="password"
              placeholder="Current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
            <input
              type="password"
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
            <button
              type="submit"
              disabled={
                busy || !currentPassword || !newPassword || !confirmPassword
              }
            >
              Update password
            </button>
          </form>
          {ok && <p className="ok">{ok}</p>}
          {error && <p className="error">{error}</p>}
        </div>
      )}
    </section>
  );
}

function AdminPanel() {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>(
    {},
  );
  const [open, setOpen] = useState(false);

  const loadUsers = useCallback(async () => {
    const res = await fetch("/api/admin/users");
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to load users");
      return;
    }
    setUsers(data.users);
    setError(null);
  }, []);

  useEffect(() => {
    if (open) void loadUsers();
  }, [open, loadUsers]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          role: "user",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Create failed");
        return;
      }
      setNewUsername("");
      setNewPassword("");
      await loadUsers();
    } finally {
      setBusy(false);
    }
  }

  async function setMode(userId: string, group: GroupId, mode: AccessMode) {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId, acl: { [group]: mode } }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Update failed");
        return;
      }
      await loadUsers();
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(userId: string, username: string) {
    const password = passwordDrafts[userId]?.trim() ?? "";
    if (!password) {
      setError("Enter a new password first");
      return;
    }
    if (!confirm(`Reset password for ${username}?`)) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Password reset failed");
        return;
      }
      setPasswordDrafts((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
      setOk(`Password updated for ${username}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeUser(userId: string) {
    if (!confirm("Delete this user?")) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Delete failed");
        return;
      }
      await loadUsers();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel admin-panel">
      <button
        type="button"
        className="admin-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <h2>Users & access</h2>
        <span className="chevron" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="admin-body">
          <form className="admin-create" onSubmit={create}>
            <input
              placeholder="Username"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              autoComplete="off"
            />
            <input
              type="password"
              placeholder="Password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
            <button
              type="submit"
              disabled={busy || !newUsername || !newPassword}
            >
              Add user
            </button>
          </form>

          {users.map(({ user, acl }) => (
            <div key={user.id} className="admin-user">
              <div className="admin-user-head">
                <strong>{user.username}</strong>
                <span className="admin-role">{user.role}</span>
                {user.role !== "admin" && (
                  <button
                    type="button"
                    className="admin-delete"
                    disabled={busy}
                    onClick={() => void removeUser(user.id)}
                  >
                    Delete
                  </button>
                )}
              </div>
              <div className="admin-password-row">
                <input
                  type="password"
                  placeholder="New password"
                  value={passwordDrafts[user.id] ?? ""}
                  onChange={(e) =>
                    setPasswordDrafts((prev) => ({
                      ...prev,
                      [user.id]: e.target.value,
                    }))
                  }
                  autoComplete="new-password"
                  disabled={busy}
                />
                <button
                  type="button"
                  disabled={busy || !(passwordDrafts[user.id] ?? "").trim()}
                  onClick={() => void resetPassword(user.id, user.username)}
                >
                  Set password
                </button>
              </div>
              <div className="admin-acl">
                {GROUPS.map((g) => (
                  <label key={g.id} className="admin-acl-row">
                    <span>{g.title}</span>
                    <select
                      value={acl[g.id] ?? "never"}
                      disabled={busy || user.role === "admin"}
                      onChange={(e) =>
                        void setMode(
                          user.id,
                          g.id,
                          e.target.value as AccessMode,
                        )
                      }
                    >
                      {ACCESS_MODES.map((mode) => (
                        <option key={mode} value={mode}>
                          {mode === "always"
                            ? "Always"
                            : mode === "home"
                              ? "Home only"
                              : "Never"}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          ))}

          {ok && <p className="ok">{ok}</p>}
          {error && <p className="error">{error}</p>}
        </div>
      )}
    </section>
  );
}

export default function Home() {
  const [needsLogin, setNeedsLogin] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState<MeUser | null>(null);
  const [homeInfo, setHomeInfo] = useState<HomeInfo | null>(null);
  const [allowedGroups, setAllowedGroups] = useState<AllowedGroup[]>([]);
  const [coords, setCoords] = useState<HomeCoords | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoHint, setGeoHint] = useState<string | null>(null);
  const [rooms, setRooms] = useState<Partial<Record<RoomSlug, RoomState>>>({});
  const [garage, setGarage] = useState<GarageState | null>(null);
  const [garagePendingOpen, setGaragePendingOpen] = useState<boolean | null>(
    null,
  );
  const garagePendingSinceRef = useRef(0);
  const geoFetchedAtRef = useRef(0);
  const geoInFlightRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<RoomSlug | null>(null);
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null);
  const [homeBusy, setHomeBusy] = useState(false);
  const [garageBusy, setGarageBusy] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);

  const allowedRoomSlugs = allowedGroups
    .filter((g) => g.id !== "garage")
    .map((g) => g.id as RoomSlug);
  const garageAllowed = allowedGroups.some((g) => g.id === "garage");

  const loadedRooms = allowedRoomSlugs
    .map((slug) => rooms[slug])
    .filter((room): room is RoomState => Boolean(room));
  const anyRoomOn = loadedRooms.some((room) => room.on || room.mixed);
  const allRoomsOn =
    loadedRooms.length > 0 &&
    loadedRooms.every((room) => room.on && !room.mixed);
  const roomsReady =
    allowedRoomSlugs.length === 0 ||
    loadedRooms.length === allowedRoomSlugs.length;

  const garageDisplayOpen = garagePendingOpen ?? garage?.open ?? false;
  const garagePending =
    garagePendingOpen !== null &&
    garage !== null &&
    garagePendingOpen !== garage.open;

  function clearGaragePendingIfConfirmed(nextOpen: boolean) {
    setGaragePendingOpen((pending) => {
      if (pending === null) return null;
      if (nextOpen !== pending) return pending;
      const elapsed = Date.now() - garagePendingSinceRef.current;
      if (elapsed >= 15_000) return null;
      return pending;
    });
  }

  const refreshMe = useCallback(async (withCoords?: HomeCoords | null) => {
    const res = withCoords
      ? await fetch("/api/me", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(withCoords),
        })
      : await fetch(withCoordsPath("/api/me", withCoords));
    const data = await res.json();
    if (res.status === 401) {
      setNeedsLogin(true);
      setUser(null);
      setAllowedGroups([]);
      return null;
    }
    if (!res.ok) {
      setError(data.error ?? "Failed to load session");
      return null;
    }
    setNeedsLogin(false);
    setUser(data.user);
    setHomeInfo(data.home);
    setAllowedGroups(data.groups ?? []);
    return data as {
      user: MeUser;
      home: HomeInfo;
      groups: AllowedGroup[];
    };
  }, []);

  const applyCoords = useCallback((pos: HomeCoords | null) => {
    setCoords(pos);
    storeCoords(pos);
  }, []);

  const requestHomeLocation = useCallback(async (forceFresh = true) => {
    if (geoInFlightRef.current) return null;
    geoInFlightRef.current = true;
    setGeoBusy(true);
    setGeoHint(null);
    try {
      const pos = await getGeolocation(forceFresh);
      if (!pos) {
        setGeoHint(
          "Location unavailable. Allow location for this site, or turn off iCloud Private Relay for Safari.",
        );
        return null;
      }
      applyCoords(pos);
      geoFetchedAtRef.current = Date.now();
      const me = await refreshMe(pos);
      if (me && !me.home.home) {
        setGeoHint(
          me.home.proxied
            ? "Still away — Private Relay hides your home IP. Location is outside the home geofence."
            : "Still away — location is outside the home geofence.",
        );
      } else if (me?.home.home) {
        setGeoHint(null);
      }
      return pos;
    } finally {
      geoInFlightRef.current = false;
      setGeoBusy(false);
    }
  }, [applyCoords, refreshMe]);

  const load = useCallback(async () => {
    setError(null);

    const stored = readStoredCoords();
    let activeCoords: HomeCoords | null = coords ?? stored;
    if (stored && !geoFetchedAtRef.current) {
      geoFetchedAtRef.current = stored.at;
    }
    if (activeCoords && !coords) {
      setCoords(activeCoords);
    }

    let me = await refreshMe(activeCoords);
    if (!me) {
      setRooms({});
      setGarage(null);
      return;
    }

    // Re-read GPS on an interval (and once when first needed). Dashboard
    // data polls faster, but reuses the last fix between geo refreshes.
    const geoAge = Date.now() - geoFetchedAtRef.current;
    const shouldRefreshGeo =
      me.home.geoConfigured &&
      !geoInFlightRef.current &&
      (geoFetchedAtRef.current === 0 || geoAge >= GEO_REFRESH_MS);

    if (shouldRefreshGeo) {
      const pos = await getGeolocation(geoFetchedAtRef.current !== 0);
      if (pos) {
        applyCoords(pos);
        activeCoords = pos;
        geoFetchedAtRef.current = Date.now();
        me = await refreshMe(pos);
        if (!me) {
          setRooms({});
          setGarage(null);
          return;
        }
        if (me.home.home) setGeoHint(null);
      } else if (!activeCoords && me.home.proxied) {
        setGeoHint(
          "Safari is using iCloud Private Relay, so Wi‑Fi IP cannot prove home. Tap Share location.",
        );
      }
    }

    const groups: AllowedGroup[] = me.groups ?? [];
    const roomSlugs = groups
      .filter((g) => g.id !== "garage")
      .map((g) => g.id as RoomSlug);
    const includeGarage = groups.some((g) => g.id === "garage");

    const [roomResults, garageRes] = await Promise.all([
      Promise.all(
        roomSlugs.map(async (slug) => {
          const res = await fetch(withCoordsPath(`/api/rooms/${slug}`, activeCoords));
          return { slug, res, data: await res.json() };
        }),
      ),
      includeGarage
        ? fetch(withCoordsPath("/api/garage", activeCoords))
        : Promise.resolve(null),
    ]);

    if (roomResults.some((r) => r.res.status === 401)) {
      setNeedsLogin(true);
      setRooms({});
      setGarage(null);
      return;
    }

    const next: Partial<Record<RoomSlug, RoomState>> = {};
    for (const { slug, res, data } of roomResults) {
      if (!res.ok) {
        if (res.status !== 403) setError(data.error ?? `Failed to load ${slug}`);
        continue;
      }
      next[slug] = data;
    }
    setRooms(next);

    if (garageRes) {
      const garageData = await garageRes.json();
      if (garageRes.status === 401) {
        setNeedsLogin(true);
        setGarage(null);
        return;
      }
      if (!garageRes.ok) {
        if (garageRes.status !== 403) {
          setError(garageData.error ?? "Failed to load Garage");
        }
        setGarage(null);
      } else {
        setGarage(garageData);
        clearGaragePendingIfConfirmed(Boolean(garageData.open));
      }
    } else {
      setGarage(null);
    }
  }, [applyCoords, coords, refreshMe]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), DASHBOARD_POLL_MS);
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
        body: JSON.stringify({
          username: username.trim() || undefined,
          password,
        }),
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

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    setUser(null);
    setNeedsLogin(true);
    setRooms({});
    setGarage(null);
    setAllowedGroups([]);
  }

  function bodyWithCoords<T extends Record<string, unknown>>(base: T) {
    if (!coords) return base;
    return { ...base, lat: coords.lat, lng: coords.lng };
  }

  async function toggleMaster(slug: RoomSlug) {
    const state = rooms[slug];
    if (!state || busySlug || homeBusy || garageBusy) return;
    const nextOn = state.mixed || state.on ? false : true;
    setBusySlug(slug);
    setError(null);
    try {
      const res = await fetch(`/api/rooms/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyWithCoords({ on: nextOn })),
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
    if (!roomsReady || homeBusy || busySlug || busyDeviceId || garageBusy) return;
    if (allowedRoomSlugs.length === 0) return;
    setHomeBusy(true);
    setError(null);
    try {
      const results = await Promise.all(
        allowedRoomSlugs.map(async (slug) => {
          const res = await fetch(`/api/rooms/${slug}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(bodyWithCoords({ on })),
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
    if (busySlug || busyDeviceId || homeBusy || garageBusy) return;
    setBusyDeviceId(deviceId);
    setError(null);
    try {
      const res = await fetch(`/api/rooms/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          bodyWithCoords({ deviceId, on: !currentlyOn }),
        ),
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

  async function setGarageDoor(open: boolean) {
    if (garageBusy || homeBusy || busySlug || busyDeviceId) return;
    setGaragePendingOpen(open);
    garagePendingSinceRef.current = Date.now();
    setGarageBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/garage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyWithCoords({ open })),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Garage command failed");
        setGaragePendingOpen(null);
        return;
      }
      setGarage(data);
      clearGaragePendingIfConfirmed(Boolean(data.open));
    } finally {
      setGarageBusy(false);
    }
  }

  const homeLabel =
    homeInfo?.reason === "disabled"
      ? null
      : homeInfo?.home
        ? "Home"
        : "Away";

  const showAwayBanner =
    Boolean(user) &&
    Boolean(homeInfo) &&
    homeInfo?.reason !== "disabled" &&
    !homeInfo?.home;

  return (
    <main className="page">
      <div className="glow" aria-hidden />
      <div className="shell">
        <header className="hero">
          <p className="brand">Homey</p>
          <h1>Home</h1>
          {user && (
            <div className="session-meta">
              {homeLabel && (
                <span
                  className={`home-pill ${homeInfo?.home ? "is-home" : "is-away"}`}
                >
                  {homeLabel}
                </span>
              )}
              <span className="session-user">{user.username}</span>
              <button type="button" className="logout-btn" onClick={() => void logout()}>
                Log out
              </button>
            </div>
          )}
        </header>

        {showAwayBanner && (
          <div className="home-away-banner" role="status">
            <p>
              {homeInfo?.proxied
                ? "iCloud Private Relay hides your home Wi‑Fi IP."
                : "Not on the home WAN IP."}
              {homeInfo?.geoConfigured
                ? " Share location to confirm you’re home."
                : " Set HOME_LAT/HOME_LNG (or Homey → Settings → Location) so location can prove home."}
            </p>
            {homeInfo?.geoConfigured && (
              <button
                type="button"
                className="locate-btn"
                disabled={geoBusy}
                onClick={() => void requestHomeLocation().then((pos) => {
                  if (pos) void load();
                })}
              >
                {geoBusy ? "Locating…" : "Share location"}
              </button>
            )}
            {geoHint && <p className="home-away-hint">{geoHint}</p>}
          </div>
        )}

        {needsLogin ? (
          <section className="panel">
            <form className="login" onSubmit={login}>
              <input
                type="text"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button
                type="submit"
                disabled={loginBusy || !password}
              >
                Unlock
              </button>
            </form>
          </section>
        ) : (
          <>
            {allowedRoomSlugs.length > 0 && (
              <section className="home-master" aria-label="All rooms">
                <span className="home-master-label">
                  {homeBusy
                    ? "Updating…"
                    : !roomsReady
                      ? "Loading…"
                      : allRoomsOn
                        ? "All on"
                        : anyRoomOn
                          ? "All"
                          : "All off"}
                </span>
                <div className="home-master-actions">
                  <button
                    type="button"
                    className={`home-power${allRoomsOn ? " is-active" : ""}`}
                    disabled={
                      !roomsReady ||
                      homeBusy ||
                      busySlug !== null ||
                      garageBusy ||
                      allRoomsOn
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
                      !roomsReady ||
                      homeBusy ||
                      busySlug !== null ||
                      garageBusy ||
                      !anyRoomOn
                    }
                    onClick={() => void setAllRoomsPower(false)}
                  >
                    Off
                  </button>
                </div>
              </section>
            )}

            <div className="rooms">
              {garageAllowed && (
                <GarageCard
                  displayOpen={garageDisplayOpen}
                  pending={garagePending}
                  busy={garageBusy || !garage}
                  locked={false}
                  onSetOpen={(open) => void setGarageDoor(open)}
                />
              )}
              {ROOMS.filter(({ slug }) => allowedRoomSlugs.includes(slug)).map(
                ({ slug, title }) => (
                  <RoomCard
                    key={slug}
                    title={title}
                    state={rooms[slug] ?? null}
                    busy={busySlug === slug || homeBusy || garageBusy}
                    busyDeviceId={busyDeviceId}
                    onToggleMaster={() => void toggleMaster(slug)}
                    onToggleDevice={(deviceId, currentlyOn) =>
                      void toggleDevice(slug, deviceId, currentlyOn)
                    }
                  />
                ),
              )}
            </div>

            {allowedGroups.length === 0 && (
              <p className="empty-state">No controls available</p>
            )}

            {user && user.id !== "dev" && <AccountPanel />}
            {user?.role === "admin" && <AdminPanel />}
          </>
        )}

        {error && <p className="error">{error}</p>}

        <p className="app-version" aria-label={`App version ${APP_VERSION}`}>
          v{APP_VERSION}
        </p>
      </div>
    </main>
  );
}
