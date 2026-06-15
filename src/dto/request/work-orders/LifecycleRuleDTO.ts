import { z } from 'zod';

// RFC-0041 Phase 3 — admin DTOs for editing a tenant's WO lifecycle flow.

const WO_TYPES = ['INSTALACAO', 'MANUTENCAO', 'VISITA_TECNICA'] as const;
const WO_STATUSES = [
  'PLANEJADA',
  'EM_ANDAMENTO',
  'INTERROMPIDA',
  'AGUARDANDO',
  'REAGENDADA',
  'FINALIZADA',
  'CANCELADA',
] as const;

export const LifecycleRuleSchema = z.object({
  woType: z.enum(WO_TYPES).nullable().optional().default(null),
  eventType: z.string().min(1).max(100),
  predecessors: z.array(z.string().min(1).max(100)).max(100).optional().default([]),
  predecessorRule: z.enum(['NONE', 'ANY', 'ALL']).optional().default('NONE'),
  activates: z.array(z.string().min(1).max(100)).max(100).optional().default([]),
  projectsStatus: z.enum(WO_STATUSES).nullable().optional().default(null),
  isEntry: z.boolean().optional().default(false),
  isTerminal: z.boolean().optional().default(false),
  sortOrder: z.number().int().min(0).max(100000).optional().default(0),
  active: z.boolean().optional().default(true),
});
export type LifecycleRuleDTO = z.infer<typeof LifecycleRuleSchema>;

/** Full-replace of the tenant's flow (idempotent: replaces all rows). */
export const ReplaceLifecycleRulesSchema = z.object({
  rules: z.array(LifecycleRuleSchema).max(500),
});
export type ReplaceLifecycleRulesDTO = z.infer<typeof ReplaceLifecycleRulesSchema>;
