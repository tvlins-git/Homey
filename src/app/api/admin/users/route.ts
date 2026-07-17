import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { isAccessMode } from "@/lib/acl";
import { GROUP_IDS, type GroupId } from "@/lib/groups";
import {
  createUser,
  deleteUser,
  listUsers,
  updateUserAcl,
  updateUserPassword,
  type UserAcl,
} from "@/lib/users";

async function requireAdmin() {
  const session = await requireSession();
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (session.role !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}

export async function GET() {
  const gate = await requireAdmin();
  if ("error" in gate && gate.error) return gate.error;

  const users = await listUsers();
  return NextResponse.json({ users, groups: GROUP_IDS });
}

export async function POST(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate && gate.error) return gate.error;

  const body = (await request.json().catch(() => null)) as {
    username?: string;
    password?: string;
    role?: "admin" | "user";
    acl?: Partial<UserAcl>;
  } | null;

  if (!body?.username || !body?.password) {
    return NextResponse.json(
      { error: "username and password required" },
      { status: 400 },
    );
  }

  try {
    const created = await createUser({
      username: body.username,
      password: body.password,
      role: body.role,
      acl: body.acl,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Create failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate && gate.error) return gate.error;

  const body = (await request.json().catch(() => null)) as {
    id?: string;
    acl?: Partial<Record<GroupId, string>>;
    password?: string;
  } | null;

  if (!body?.id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  try {
    let acl: UserAcl | undefined;
    if (body.acl) {
      const patch: Partial<UserAcl> = {};
      for (const id of GROUP_IDS) {
        const mode = body.acl[id];
        if (isAccessMode(mode)) patch[id] = mode;
      }
      acl = await updateUserAcl(body.id, patch);
    }
    if (body.password) {
      await updateUserPassword(body.id, body.password);
    }
    return NextResponse.json({ ok: true, acl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate && gate.error) return gate.error;

  const body = (await request.json().catch(() => null)) as { id?: string } | null;
  if (!body?.id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  try {
    await deleteUser(body.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
