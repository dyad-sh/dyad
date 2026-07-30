const stages = ['lead', 'qualified', 'proposal', 'won', 'lost'] as const;
export function validateBodyStrings(body: unknown) { if (!body || typeof body !== 'object') return 'Invalid request body.'; for (const value of Object.values(body as Record<string, unknown>)) if (typeof value === 'string' && value.length > 500) return 'Text fields must be 500 characters or fewer.'; return null; }
export function requiredText(value: unknown, label: string) { if (typeof value !== 'string' || !value.trim()) return `${label} is required.`; return null; }
export function validEmail(value: unknown) { if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'A valid email is required.'; return null; }
export function validDealAmount(value: unknown) { const amount = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN; if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < 0) return 'Amount must be a non-negative whole number.'; return null; }
export function validStage(value: unknown) { if (!stages.includes(value as typeof stages[number])) return 'Invalid deal stage.'; return null; }
export { stages };
