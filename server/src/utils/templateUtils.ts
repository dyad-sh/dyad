/**
 * Template utilities for loading templates and their system prompts
 */

import { localTemplatesData, Template } from '../../../shared/templates';

/**
 * Get template by ID
 */
export function getTemplateById(templateId: string): Template | undefined {
    return localTemplatesData.find((t: Template) => t.id === templateId);
}

/**
 * Get system prompt for a template
 * Returns the template's systemPrompt if available, otherwise undefined
 */
export function getTemplateSystemPrompt(templateId: string | null | undefined): string | undefined {
    if (!templateId) return undefined;

    const template = getTemplateById(templateId);
    return template?.systemPrompt;
}
