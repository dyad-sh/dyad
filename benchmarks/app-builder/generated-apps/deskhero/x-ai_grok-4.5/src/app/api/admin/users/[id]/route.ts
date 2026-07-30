import { requireRole } from "@/lib/api-auth";
import { recordAuditEvent } from "@/lib/audit";
import { isRole } from "@/lib/roles";
import { setUserActive, setUserRole } from "@/lib/users";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const result = await requireRole("admin");
  if ("response" in result) {
    return result.response;
  }

  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const payload = body as { role?: unknown; active?: unknown };

  if (payload.role === undefined && payload.active === undefined) {
    return Response.json(
      { error: "Provide role and/or active" },
      { status: 400 },
    );
  }

  if (payload.role !== undefined && !isRole(payload.role)) {
    return Response.json({ error: "Invalid role" }, { status: 400 });
  }

  if (payload.active !== undefined && typeof payload.active !== "boolean") {
    return Response.json({ error: "Invalid active flag" }, { status: 400 });
  }

  if (payload.active !== undefined && id === result.user.id) {
    return Response.json(
      { error: "Admins cannot deactivate themselves" },
      { status: 403 },
    );
  }

  let user = null;

  if (payload.role !== undefined && isRole(payload.role)) {
    const updated = await setUserRole(id, payload.role);
    if (!updated) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    if (updated.previousRole !== updated.user.role) {
      await recordAuditEvent({
        actorId: result.user.id,
        eventType: "role_change",
        targetType: "user",
        targetId: id,
        detail: `${updated.previousRole} → ${updated.user.role}`,
      });
    }
    user = updated.user;
  }

  if (typeof payload.active === "boolean") {
    const updated = await setUserActive(id, payload.active);
    if (!updated) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    if (updated.previousActive !== updated.user.active) {
      await recordAuditEvent({
        actorId: result.user.id,
        eventType: "activation_change",
        targetType: "user",
        targetId: id,
        detail: `${updated.previousActive ? "active" : "deactivated"} → ${updated.user.active ? "active" : "deactivated"}`,
      });
    }
    user = updated.user;
  }

  if (!user) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json(user);
}
