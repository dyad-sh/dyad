import { createLoggedHandler } from "./safe_handle";
import log from "electron-log";
import { getAllTemplates } from "../utils/template_utils";
import { localTemplatesData, type Template } from "../../shared/templates";

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
}
