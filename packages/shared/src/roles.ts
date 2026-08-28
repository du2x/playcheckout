/** Player roles. Exactly one saboteur per round (prd FR-2). */
export const ROLES = ['staff', 'saboteur'] as const
export type Role = (typeof ROLES)[number]
