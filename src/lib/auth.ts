import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";
import {
  ensureUsersSeeded,
  findUserByUsername,
  getUserAcl,
  getUserById,
  type PublicUser,
  type UserAcl,
  usersConfigFingerprint,
  verifyPassword,
} from "@/lib/users";
import { canControl, type AccessMode } from "@/lib/acl";
import type { GroupId } from "@/lib/groups";

const COOKIE_NAME = "homey_dashboard_session";
const SESSION_DAYS = 30;

export type SessionPayload = {
  userId: string;
  role: "admin" | "user";
  exp: number;
};

export type SessionUser = PublicUser & { acl: UserAcl };

function sessionSecret(): string {
  return (
    process.env.SESSION_SECRET?.trim() ||
    process.env.ADMIN_PASSWORD?.trim() ||
    process.env.DASHBOARD_PASSWORD?.trim() ||
    `dev-session-${usersConfigFingerprint()}`
  );
}

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("hex");
}

function encodeSession(session: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(session), "utf8").toString(
    "base64url",
  );
  return `${body}.${sign(body)}`;
}

function decodeSession(value: string): SessionPayload | null {
  const [body, sig] = value.split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as SessionPayload;
    if (
      !parsed?.userId ||
      (parsed.role !== "admin" && parsed.role !== "user") ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }
    if (Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Legacy single-password cookie (pre multi-user). */
function legacyExpectedToken(password: string): string {
  return createHmac("sha256", password).update("homey-dashboard").digest("hex");
}

export async function getSession(): Promise<SessionUser | null> {
  await ensureUsersSeeded();
  const jar = await cookies();
  const value = jar.get(COOKIE_NAME)?.value;
  if (!value) return null;

  const payload = decodeSession(value);
  if (payload) {
    const user = await getUserById(payload.userId);
    if (!user) return null;
    const acl = await getUserAcl(user.id);
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      acl,
    };
  }

  // Migrate legacy shared-password cookie → treat as admin if password still matches
  const password =
    process.env.ADMIN_PASSWORD?.trim() ||
    process.env.DASHBOARD_PASSWORD?.trim();
  if (password) {
    const expected = legacyExpectedToken(password);
    try {
      if (
        value.length === expected.length &&
        timingSafeEqual(Buffer.from(value), Buffer.from(expected))
      ) {
        const admin =
          (await findUserByUsername(
            process.env.ADMIN_USERNAME?.trim() || "admin",
          )) ?? null;
        if (!admin) return null;
        const acl = await getUserAcl(admin.id);
        return {
          id: admin.id,
          username: admin.username,
          role: admin.role,
          acl,
        };
      }
    } catch {
      /* ignore */
    }
  }

  return null;
}

export async function isAuthenticated(): Promise<boolean> {
  return (await requireSession()) !== null;
}

export async function requireSession(): Promise<SessionUser | null> {
  const hasPassword =
    Boolean(process.env.ADMIN_PASSWORD?.trim()) ||
    Boolean(process.env.DASHBOARD_PASSWORD?.trim());
  await ensureUsersSeeded();
  const session = await getSession();
  if (session) return session;
  if (!hasPassword) {
    // Open dev mode: synthetic admin with full ACL
    const { alwaysAcl } = await import("@/lib/groups");
    return {
      id: "dev",
      username: "dev",
      role: "admin",
      acl: alwaysAcl(),
    };
  }
  return null;
}

export async function authenticateUser(
  username: string,
  password: string,
): Promise<SessionUser | null> {
  await ensureUsersSeeded();
  const user = await findUserByUsername(username);
  if (!user) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  const acl = await getUserAcl(user.id);
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    acl,
  };
}

export function createSessionCookieValue(user: PublicUser): string {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  return encodeSession({ userId: user.id, role: user.role, exp });
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}

export function userCanAccessGroup(
  user: SessionUser,
  group: GroupId,
  isHome: boolean,
): boolean {
  if (user.role === "admin") return true;
  const mode: AccessMode = user.acl[group] ?? "never";
  return canControl(mode, isHome);
}

export { COOKIE_NAME };

/** @deprecated use createSessionCookieValue */
export function sessionCookieValue(password: string): string {
  return legacyExpectedToken(password);
}
