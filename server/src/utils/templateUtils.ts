/**
 * Template utilities for loading templates and their system prompts
 */

import { localTemplatesData, DEFAULT_TEMPLATE } from '../shared/templates.js';

/**
 * Get template by ID
 */
export function getTemplateById(templateId: string) {
    return localTemplatesData.find(t => t.id === templateId);
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
