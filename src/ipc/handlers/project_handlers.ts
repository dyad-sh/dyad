import crypto from "node:crypto";
import { desc, eq } from "drizzle-orm";
import log from "electron-log";

import { db } from "../../db";
import { projects } from "../../db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { createTypedHandler } from "./base";
import { projectContracts } from "../types/project";

const logger = log.scope("project_handlers");

function toDto(row: typeof projects.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

export function registerProjectHandlers() {
  createTypedHandler(projectContracts.list, async () => {
    const rows = await db
      .select()
      .from(projects)
      .orderBy(desc(projects.updatedAt));
    return rows.map(toDto);
  });

  createTypedHandler(projectContracts.create, async (_event, input) => {
    const now = new Date();
    const [created] = await db
      .insert(projects)
      .values({
        id: crypto.randomUUID(),
        name: input.name.trim(),
        description: input.description?.trim() || null,
        instructions: input.instructions?.trim() || null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return toDto(created);
  });

  createTypedHandler(projectContracts.update, async (_event, input) => {
    const [updated] = await db
      .update(projects)
      .set({
        // Only what was sent: a partial update must not blank the rest.
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined
          ? { description: input.description.trim() || null }
          : {}),
        ...(input.instructions !== undefined
          ? { instructions: input.instructions.trim() || null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, input.id))
      .returning();

    if (!updated) {
      throw new DyadError(
        "That project no longer exists.",
        DyadErrorKind.NotFound,
      );
    }
    return toDto(updated);
  });

  createTypedHandler(projectContracts.delete, async (_event, { id }) => {
    await db.delete(projects).where(eq(projects.id, id));
  });

  logger.info("Project handlers registered");
}
