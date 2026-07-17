import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { Redis } from "@upstash/redis";
import type { AccessMode } from "@/lib/acl";
import { isAccessMode } from "@/lib/acl";
import {
  alwaysAcl,
  emptyAcl,
  GROUP_IDS,
  type GroupId,
} from "@/lib/groups";

export type UserRole = "admin" | "user";

export type DashboardUser = {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
};

export type PublicUser = {
  id: string;
  username: string;
  role: UserRole;
};

export type UserAcl = Record<GroupId, AccessMode>;

const USERS_KEY = "dashboard:users";
const userKey = (id: string) => `dashboard:user:${id}`;
const aclKey = (id: string) => `dashboard:acl:${id}`;
const usernameKey = (username: string) =>
  `dashboard:username:${username.toLowerCase()}`;

type MemoryStore = {
  users: Map<string, DashboardUser>;
  acls: Map<string, UserAcl>;
  usernames: Map<string, string>;
};

const globalStore = globalThis as typeof globalThis & {
  __homeyDashboardUsers?: MemoryStore;
};

function memoryStore(): MemoryStore {
  if (!globalStore.__homeyDashboardUsers) {
    globalStore.__homeyDashboardUsers = {
      users: new Map(),
      acls: new Map(),
      usernames: new Map(),
    };
  }
  return globalStore.__homeyDashboardUsers;
}

function getRedis(): Redis | null {
  const url =
    process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function hashPassword(password: string, salt?: string): string {
  const usedSalt = salt ?? randomBytes(16).toString("hex");
  const hash = scryptSync(password, usedSalt, 64).toString("hex");
  return `${usedSalt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const next = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (expected.length !== next.length) return false;
  return timingSafeEqual(expected, next);
}

function newUserId(): string {
  return randomBytes(12).toString("hex");
}

function normalizeAcl(raw: unknown): UserAcl {
  const base = emptyAcl();
  if (!raw || typeof raw !== "object") return base;
  const obj = raw as Record<string, unknown>;
  for (const id of GROUP_IDS) {
    if (isAccessMode(obj[id])) base[id] = obj[id];
  }
  return base;
}

function toPublic(user: DashboardUser): PublicUser {
  return { id: user.id, username: user.username, role: user.role };
}

async function listUserIds(redis: Redis | null): Promise<string[]> {
  if (redis) {
    const ids = await redis.smembers(USERS_KEY);
    return ids ?? [];
  }
  return [...memoryStore().users.keys()];
}

async function readUser(
  redis: Redis | null,
  id: string,
): Promise<DashboardUser | null> {
  if (redis) {
    const raw = await redis.get<DashboardUser | string>(userKey(id));
    if (!raw) return null;
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw) as DashboardUser;
      } catch {
        return null;
      }
    }
    return raw;
  }
  return memoryStore().users.get(id) ?? null;
}

async function writeUser(
  redis: Redis | null,
  user: DashboardUser,
  acl: UserAcl,
): Promise<void> {
  if (redis) {
    await redis.set(userKey(user.id), user);
    await redis.set(aclKey(user.id), acl);
    await redis.set(usernameKey(user.username), user.id);
    await redis.sadd(USERS_KEY, user.id);
    return;
  }
  const mem = memoryStore();
  mem.users.set(user.id, user);
  mem.acls.set(user.id, acl);
  mem.usernames.set(user.username.toLowerCase(), user.id);
}

async function readAcl(redis: Redis | null, id: string): Promise<UserAcl> {
  if (redis) {
    const raw = await redis.get<UserAcl | string>(aclKey(id));
    if (!raw) return emptyAcl();
    if (typeof raw === "string") {
      try {
        return normalizeAcl(JSON.parse(raw));
      } catch {
        return emptyAcl();
      }
    }
    return normalizeAcl(raw);
  }
  return memoryStore().acls.get(id) ?? emptyAcl();
}

let seedPromise: Promise<void> | null = null;

export async function ensureUsersSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = seedAdminIfNeeded().finally(() => {
      /* keep promise resolved for subsequent calls */
    });
  }
  await seedPromise;
}

async function seedAdminIfNeeded(): Promise<void> {
  const redis = getRedis();
  const ids = await listUserIds(redis);
  if (ids.length > 0) return;

  const username =
    process.env.ADMIN_USERNAME?.trim() ||
    process.env.DASHBOARD_ADMIN_USERNAME?.trim() ||
    "admin";
  const password =
    process.env.ADMIN_PASSWORD?.trim() ||
    process.env.DASHBOARD_PASSWORD?.trim();

  if (!password) return;

  const user: DashboardUser = {
    id: newUserId(),
    username,
    passwordHash: hashPassword(password),
    role: "admin",
  };
  await writeUser(redis, user, alwaysAcl());
}

export async function findUserByUsername(
  username: string,
): Promise<DashboardUser | null> {
  await ensureUsersSeeded();
  const redis = getRedis();
  const key = username.trim().toLowerCase();
  if (!key) return null;

  if (redis) {
    const id = await redis.get<string>(usernameKey(key));
    if (!id) return null;
    return readUser(redis, id);
  }

  const id = memoryStore().usernames.get(key);
  if (!id) return null;
  return memoryStore().users.get(id) ?? null;
}

export async function getUserById(
  id: string,
): Promise<DashboardUser | null> {
  await ensureUsersSeeded();
  return readUser(getRedis(), id);
}

export async function getUserAcl(userId: string): Promise<UserAcl> {
  await ensureUsersSeeded();
  return readAcl(getRedis(), userId);
}

export async function listUsers(): Promise<
  { user: PublicUser; acl: UserAcl }[]
> {
  await ensureUsersSeeded();
  const redis = getRedis();
  const ids = await listUserIds(redis);
  const out: { user: PublicUser; acl: UserAcl }[] = [];
  for (const id of ids) {
    const user = await readUser(redis, id);
    if (!user) continue;
    out.push({ user: toPublic(user), acl: await readAcl(redis, id) });
  }
  out.sort((a, b) => a.user.username.localeCompare(b.user.username));
  return out;
}

export async function createUser(input: {
  username: string;
  password: string;
  role?: UserRole;
  acl?: Partial<UserAcl>;
}): Promise<{ user: PublicUser; acl: UserAcl }> {
  await ensureUsersSeeded();
  const username = input.username.trim();
  if (!username || username.length < 2) {
    throw new Error("Username must be at least 2 characters");
  }
  if (!input.password || input.password.length < 4) {
    throw new Error("Password must be at least 4 characters");
  }
  if (await findUserByUsername(username)) {
    throw new Error("Username already exists");
  }

  const redis = getRedis();
  const user: DashboardUser = {
    id: newUserId(),
    username,
    passwordHash: hashPassword(input.password),
    role: input.role === "admin" ? "admin" : "user",
  };
  const acl = emptyAcl();
  if (input.acl) {
    for (const id of GROUP_IDS) {
      if (isAccessMode(input.acl[id])) acl[id] = input.acl[id]!;
    }
  }
  if (user.role === "admin") {
    Object.assign(acl, alwaysAcl());
  }
  await writeUser(redis, user, acl);
  return { user: toPublic(user), acl };
}

export async function updateUserAcl(
  userId: string,
  aclPatch: Partial<UserAcl>,
): Promise<UserAcl> {
  await ensureUsersSeeded();
  const redis = getRedis();
  const user = await readUser(redis, userId);
  if (!user) throw new Error("User not found");

  const acl = await readAcl(redis, userId);
  for (const id of GROUP_IDS) {
    if (isAccessMode(aclPatch[id])) acl[id] = aclPatch[id]!;
  }
  if (redis) {
    await redis.set(aclKey(userId), acl);
  } else {
    memoryStore().acls.set(userId, acl);
  }
  return acl;
}

export async function updateUserPassword(
  userId: string,
  password: string,
): Promise<void> {
  await ensureUsersSeeded();
  if (!password || password.length < 4) {
    throw new Error("Password must be at least 4 characters");
  }
  const redis = getRedis();
  const user = await readUser(redis, userId);
  if (!user) throw new Error("User not found");
  user.passwordHash = hashPassword(password);
  if (redis) {
    await redis.set(userKey(userId), user);
  } else {
    memoryStore().users.set(userId, user);
  }
}

export async function deleteUser(userId: string): Promise<void> {
  await ensureUsersSeeded();
  const redis = getRedis();
  const user = await readUser(redis, userId);
  if (!user) throw new Error("User not found");
  if (user.role === "admin") {
    const all = await listUsers();
    const admins = all.filter((u) => u.user.role === "admin");
    if (admins.length <= 1) {
      throw new Error("Cannot delete the last admin");
    }
  }

  if (redis) {
    await redis.del(userKey(userId));
    await redis.del(aclKey(userId));
    await redis.del(usernameKey(user.username));
    await redis.srem(USERS_KEY, userId);
    return;
  }

  const mem = memoryStore();
  mem.users.delete(userId);
  mem.acls.delete(userId);
  mem.usernames.delete(user.username.toLowerCase());
}

/** Stable fingerprint for cookie signing secret derivation. */
export function usersConfigFingerprint(): string {
  return createHash("sha256")
    .update(
      [
        process.env.ADMIN_PASSWORD ?? "",
        process.env.DASHBOARD_PASSWORD ?? "",
        process.env.KV_REST_API_TOKEN ?? "",
        process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 16);
}
