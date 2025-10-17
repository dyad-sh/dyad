import { createLoggedHandler } from "./safe_handle";
import log from "electron-log";
import { getAllTemplates } from "../utils/template_utils";
import { localTemplatesData, type Template } from "../../shared/templates";
import { readSettings, writeSettings } from "../../main/settings";
import { v4 as uuidv4 } from "uuid";
import fs from "node:fs";
import { dialog } from "electron";

const logger = log.scope("template_handlers");
const handle = createLoggedHandler(logger);

export function registerTemplateHandlers() {
  handle("get-templates", async (): Promise<Template[]> => {
    try {
      const templates = await getAllTemplates();
      return templates;
    } catch (error) {
      logger.error("Error fetching templates:", error);
      return localTemplatesData;
    }
  });

  handle(
    "add-custom-template",
    async (
      _,
      params: {
        title: string;
        description: string;
        folderPath: string;
        imageUrl?: string;
      },
    ): Promise<{ success: boolean; templateId?: string; error?: string }> => {
      try {
        // Validate folder path exists
        if (!fs.existsSync(params.folderPath)) {
          return {
            success: false,
            error: "Folder path does not exist",
          };
        }

        const settings = readSettings();
        const customTemplates = settings.customTemplates || [];

        // Generate unique ID
        const templateId = `custom-${uuidv4()}`;

        // Add new template
        const newTemplate = {
          id: templateId,
          title: params.title,
          description: params.description,
          folderPath: params.folderPath,
          imageUrl: params.imageUrl,
        };

        customTemplates.push(newTemplate);

        // Save to settings
        writeSettings({ customTemplates });

        logger.info("Added custom template:", templateId);
        return { success: true, templateId };
      } catch (error) {
        logger.error("Error adding custom template:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  handle(
    "delete-custom-template",
    async (_, templateId: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const settings = readSettings();
        const customTemplates = settings.customTemplates || [];

        // Remove template with matching ID
        const filteredTemplates = customTemplates.filter(
          (t) => t.id !== templateId,
        );

        if (filteredTemplates.length === customTemplates.length) {
          return {
            success: false,
            error: "Template not found",
          };
        }

        writeSettings({ customTemplates: filteredTemplates });

        logger.info("Deleted custom template:", templateId);
        return { success: true };
      } catch (error) {
        logger.error("Error deleting custom template:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  handle(
    "edit-custom-template",
    async (
      _,
      params: {
        templateId: string;
        title?: string;
        description?: string;
        folderPath?: string;
        imageUrl?: string;
      },
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const settings = readSettings();
        const customTemplates = settings.customTemplates || [];

        // Find template index
        const templateIndex = customTemplates.findIndex(
          (t) => t.id === params.templateId,
        );

        if (templateIndex === -1) {
          return {
            success: false,
            error: "Template not found",
          };
        }

        // Update template fields
        const template = customTemplates[templateIndex];
        if (params.title !== undefined) template.title = params.title;
        if (params.description !== undefined)
          template.description = params.description;
        if (params.folderPath !== undefined) {
          // Validate folder path exists
          if (!fs.existsSync(params.folderPath)) {
            return {
              success: false,
              error: "Folder path does not exist",
            };
          }
          template.folderPath = params.folderPath;
        }
        if (params.imageUrl !== undefined) template.imageUrl = params.imageUrl;

        customTemplates[templateIndex] = template;

        // Save to settings
        writeSettings({ customTemplates });

        logger.info("Edited custom template:", params.templateId);
        return { success: true };
      } catch (error) {
        logger.error("Error editing custom template:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  handle("select-folder", async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select Template Folder",
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  handle("select-image", async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      title: "Select Template Image",
      filters: [
        {
          name: "Images",
          extensions: ["jpg", "jpeg", "png", "gif", "webp", "svg"],
        },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });
}
