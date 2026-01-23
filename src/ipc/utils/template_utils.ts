import {
  type Template,
  type ApiTemplate,
  localTemplatesData,
} from "../../shared/templates";
import log from "electron-log";

const logger = log.scope("template_utils");

// In-memory cache for API templates
let apiTemplatesCache: Template[] | null = null;
let apiTemplatesFetchPromise: Promise<Template[]> | null = null;

// Convert API template to our Template interface
function convertApiTemplate(apiTemplate: ApiTemplate): Template {
  return {
    id: `${apiTemplate.githubOrg}/${apiTemplate.githubRepo}`,
    title: apiTemplate.title,
    description: apiTemplate.description,
    imageUrl: apiTemplate.imageUrl,
    githubUrl: `https://github.com/${apiTemplate.githubOrg}/${apiTemplate.githubRepo}`,
    isOfficial: false,
  };
}

// Fetch templates from API with caching
export async function fetchApiTemplates(): Promise<Template[]> {
  // Return cached data if available
  if (apiTemplatesCache) {
    return apiTemplatesCache;
  }

  // Return existing promise if fetch is already in progress
  if (apiTemplatesFetchPromise) {
    return apiTemplatesFetchPromise;
  }

  // Start new fetch
  apiTemplatesFetchPromise = (async (): Promise<Template[]> => {
    try {
      const response = await fetch("https://api.dyad.sh/v1/templates");
      if (!response.ok) {
        throw new Error(
          `Failed to fetch templates: ${response.status} ${response.statusText}`,
        );
      }

      const apiTemplates: ApiTemplate[] = await response.json();
      const convertedTemplates = apiTemplates.map(convertApiTemplate);

      // Cache the result
      apiTemplatesCache = convertedTemplates;
      return convertedTemplates;
    } catch (error) {
      logger.error("Failed to fetch API templates:", error);
      // Reset the promise so we can retry later
      apiTemplatesFetchPromise = null;
      return []; // Return empty array on error
    }
  })();

  return apiTemplatesFetchPromise;
}

// Get all templates (local + API)
export async function getAllTemplates(): Promise<Template[]> {
  const apiTemplates = await fetchApiTemplates();
  return [...localTemplatesData, ...apiTemplates];
}

export async function getTemplateOrThrow(
  templateId: string,
): Promise<Template> {
  const allTemplates = await getAllTemplates();
  const template = allTemplates.find((template) => template.id === templateId);
  if (!template) {
    throw new Error(
      `Template ${templateId} not found. Please select a different template.`,
    );
  }
  return template;
}
