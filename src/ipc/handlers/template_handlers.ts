import log from "electron-log";
import { getAllTemplates } from "../utils/template_utils";
import { localTemplatesData } from "../../shared/templates";
import { createTypedHandler } from "./base";
import { templateContracts } from "../types/templates";
import { db } from "@/db";
import { customTemplates } from "@/db/schema";
import { eq } from "drizzle-orm";

const logger = log.scope("template_handlers");

export function registerTemplateHandlers() {
  createTypedHandler(templateContracts.getTemplates, async () => {
    try {
      const templates = await getAllTemplates();
      return templates;
    } catch (error) {
      logger.error("Error fetching templates:", error);
      return localTemplatesData;
    }
  });

  // Custom template CRUD handlers
  createTypedHandler(templateContracts.getCustomTemplates, async () => {
    const rows = db.select().from(customTemplates).all();
    return rows.map((r) => ({
      id: r.id!,
      name: r.name,
      description: r.description,
      githubUrl: r.githubUrl,
      imageUrl: r.imageUrl,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  });

  createTypedHandler(
    templateContracts.createCustomTemplate,
    async (_, params) => {
      const { name, description, githubUrl, imageUrl } = params;
      if (!name || !githubUrl) {
        throw new Error("Name and GitHub URL are required");
      }
      const result = db
        .insert(customTemplates)
        .values({
          name,
          description,
          githubUrl,
          imageUrl,
        })
        .run();

      const id = Number(result.lastInsertRowid);
      const row = db
        .select()
        .from(customTemplates)
        .where(eq(customTemplates.id, id))
        .get();
      if (!row) throw new Error("Failed to fetch created custom template");
      return {
        id: row.id!,
        name: row.name,
        description: row.description,
        githubUrl: row.githubUrl,
        imageUrl: row.imageUrl,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    },
  );

  createTypedHandler(
    templateContracts.updateCustomTemplate,
    async (_, params) => {
      const { id, name, description, githubUrl, imageUrl } = params;
      if (!id) throw new Error("Custom template id is required");
      const now = new Date();
      const updateData: Record<string, any> = { updatedAt: now };
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (githubUrl !== undefined) updateData.githubUrl = githubUrl;
      if (imageUrl !== undefined) updateData.imageUrl = imageUrl;
      db.update(customTemplates)
        .set(updateData)
        .where(eq(customTemplates.id, id))
        .run();

      const row = db
        .select()
        .from(customTemplates)
        .where(eq(customTemplates.id, id))
        .get();
      if (!row) throw new Error("Failed to fetch updated custom template");
      return {
        id: row.id!,
        name: row.name,
        description: row.description,
        githubUrl: row.githubUrl,
        imageUrl: row.imageUrl,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    },
  );

  createTypedHandler(
    templateContracts.deleteCustomTemplate,
    async (_, params) => {
      const { id } = params;
      if (!id) throw new Error("Custom template id is required");
      db.delete(customTemplates).where(eq(customTemplates.id, id)).run();
    },
  );
}
