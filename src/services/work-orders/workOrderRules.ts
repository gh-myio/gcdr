// =============================================================================
// Work Order Rules Engine  (RFC-0041)
// =============================================================================
// Single source of truth for the WO state machine:
//   1) status projection — derive status from the latest lifecycle event;
//   2) transition evaluation — which event-types can/can't be appended now and
//      why (machine reasonCode + context).
// Pure functions, no I/O — easy to unit test and reuse from the service/endpoint.
// =============================================================================

export type WorkOrderStatusValue =
  | 'PLANEJADA'
  | 'EM_ANDAMENTO'
  | 'INTERROMPIDA'
  | 'AGUARDANDO'
  | 'REAGENDADA'
  | 'FINALIZADA'
  | 'CANCELADA';

/** Categories that drive the status projection (must match the WO's own type). */
export const LIFECYCLE_CATEGORIES = new Set([
  'VISITA_TECNICA',
  'INSTALACAO',
  'MANUTENCAO',
  'CHAMADO', // RFC-0044 — tickets; status flow is table-driven (no built-in suffix matrix)
]);

export const TERMINAL_STATUSES = new Set<WorkOrderStatusValue>(['FINALIZADA', 'CANCELADA']);

export function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.has(status as WorkOrderStatusValue);
}

/**
 * Lifecycle SUFFIX → target status. A code is `<CATEGORY>_<SUFFIX>`.
 * Returns null for non-lifecycle categories (markers never move status).
 */
export function lifecycleStateForCode(code: string, category: string): WorkOrderStatusValue | null {
  if (!LIFECYCLE_CATEGORIES.has(category)) return null;
  const suffix = code.startsWith(`${category}_`) ? code.slice(category.length + 1) : code;

  switch (suffix) {
    case 'PLANEJADA':
      return 'PLANEJADA';
    case 'INICIADA':
    case 'REINICIADA':
    case 'EXECUTADA_PARCIAL':
      return 'EM_ANDAMENTO';
    case 'INTERROMPIDA':
      return 'INTERROMPIDA';
    case 'REAGENDADA':
      return 'REAGENDADA';
    case 'AGUARDANDO_AGENDA_CLIENTE':
    case 'AGUARDANDO_AGENDA_TECNICO':
    case 'AGUARDANDO_OUTROS_MOTIVOS':
      return 'AGUARDANDO';
    case 'FINALIZADA':
      return 'FINALIZADA';
    case 'CANCELADA':
      return 'CANCELADA';
    default:
      return null;
  }
}

/** Lifecycle suffix of a code (minus the `<CATEGORY>_` prefix). */
function suffixOf(code: string, category: string): string {
  return code.startsWith(`${category}_`) ? code.slice(category.length + 1) : code;
}

/**
 * Transition guard matrix: for each lifecycle suffix, the source statuses from
 * which appending it is valid. `AGUARDANDO_*` share one rule. (RFC-0041 §3.)
 */
const ALLOWED_FROM: Record<string, WorkOrderStatusValue[]> = {
  PLANEJADA: ['PLANEJADA'],
  INICIADA: ['PLANEJADA', 'REAGENDADA', 'AGUARDANDO'],
  REINICIADA: ['INTERROMPIDA'],
  EXECUTADA_PARCIAL: ['EM_ANDAMENTO'],
  INTERROMPIDA: ['EM_ANDAMENTO'],
  REAGENDADA: ['PLANEJADA', 'EM_ANDAMENTO', 'AGUARDANDO', 'INTERROMPIDA'],
  AGUARDANDO_AGENDA_CLIENTE: ['PLANEJADA', 'EM_ANDAMENTO', 'REAGENDADA', 'INTERROMPIDA'],
  AGUARDANDO_AGENDA_TECNICO: ['PLANEJADA', 'EM_ANDAMENTO', 'REAGENDADA', 'INTERROMPIDA'],
  AGUARDANDO_OUTROS_MOTIVOS: ['PLANEJADA', 'EM_ANDAMENTO', 'REAGENDADA', 'INTERROMPIDA'],
  FINALIZADA: ['PLANEJADA', 'EM_ANDAMENTO', 'REAGENDADA', 'AGUARDANDO', 'INTERROMPIDA'],
  CANCELADA: ['PLANEJADA', 'EM_ANDAMENTO', 'REAGENDADA', 'AGUARDANDO', 'INTERROMPIDA'],
};

export type TransitionReasonCode =
  | 'TERMINAL'
  | 'TYPE_MISMATCH'
  | 'WRONG_STATE'
  | 'MISSING_PREDECESSORS';

export interface EventTypeLike {
  code: string;
  category: string;
  label: string;
  active?: boolean;
}

export interface TransitionEvaluation {
  code: string;
  category: string;
  label: string;
  /** Target status for a lifecycle event; null for non-lifecycle markers. */
  targetStatus: WorkOrderStatusValue | null;
  allowed: boolean;
  reasonCode?: TransitionReasonCode;
  /** Present when reasonCode === 'WRONG_STATE' (built-in default flow). */
  allowedFrom?: WorkOrderStatusValue[];
  /** Present when reasonCode === 'MISSING_PREDECESSORS' (table-driven flow). */
  predecessors?: string[];
  missing?: string[];
  /** Event-types this node activates next (table-driven flow). */
  activates?: string[];
}

// ── Table-driven flow (RFC-0041 §3–4) ──────────────────────────────────────

export interface LifecycleRule {
  woType: string | null; // null = applies to every WO type
  eventType: string;
  predecessors: string[];
  predecessorRule: 'NONE' | 'ANY' | 'ALL';
  activates: string[];
  projectsStatus: string | null; // null = marker
  isEntry: boolean;
  isTerminal: boolean; // closes the WO when fired
}

/**
 * Terminal statuses for a tenant's flow: statuses projected by rules flagged
 * terminal. Falls back to the built-in FINALIZADA/CANCELADA when none is set.
 */
function terminalStatusesOf(rules: LifecycleRule[]): Set<string> {
  const set = new Set<string>();
  for (const r of rules) {
    if (r.isTerminal && r.projectsStatus) set.add(r.projectsStatus);
  }
  return set.size ? set : new Set<string>(TERMINAL_STATUSES);
}

/** Most specific rule for (woType, eventType): exact wo_type wins over NULL. */
function resolveRule(
  rules: LifecycleRule[],
  woType: string,
  eventType: string,
): LifecycleRule | undefined {
  return (
    rules.find((r) => r.eventType === eventType && r.woType === woType) ??
    rules.find((r) => r.eventType === eventType && r.woType === null)
  );
}

/** Status projection from the table: latest event whose rule projects a status. */
export function projectStatusFromRules(
  woType: string,
  events: Array<{ eventType: string; createdAt?: string | Date }>,
  rules: LifecycleRule[],
  fallback: WorkOrderStatusValue = 'PLANEJADA',
): WorkOrderStatusValue {
  const sorted = [...events].sort(
    (a, b) =>
      (b.createdAt ? new Date(b.createdAt).getTime() : 0) -
      (a.createdAt ? new Date(a.createdAt).getTime() : 0),
  );
  for (const ev of sorted) {
    const rule = resolveRule(rules, woType, ev.eventType);
    if (rule?.projectsStatus) return rule.projectsStatus as WorkOrderStatusValue;
  }
  return fallback;
}

/** Evaluate one event-type against a WO using the tenant's lifecycle rules. */
export function evaluateEventTypeFromRules(
  et: EventTypeLike,
  wo: { type: string; status: string },
  occurred: Set<string>,
  rules: LifecycleRule[],
): TransitionEvaluation {
  const rule = resolveRule(rules, wo.type, et.code);
  const target = (rule?.projectsStatus ?? null) as WorkOrderStatusValue | null;
  const base: TransitionEvaluation = {
    code: et.code,
    category: et.category,
    label: et.label,
    targetStatus: target,
    allowed: true,
    activates: rule?.activates,
  };

  const isLifecycle = LIFECYCLE_CATEGORIES.has(et.category) || Boolean(target);

  // Lifecycle event of another WO type.
  if (LIFECYCLE_CATEGORIES.has(et.category) && et.category !== wo.type) {
    return { ...base, allowed: false, reasonCode: 'TYPE_MISMATCH' };
  }
  // Terminal WO accepts no further status-moving events (data-driven set).
  if (isLifecycle && terminalStatusesOf(rules).has(wo.status)) {
    return { ...base, allowed: false, reasonCode: 'TERMINAL' };
  }
  // No governing row → ungated (markers, or lifecycle types the tenant left open).
  if (!rule) return base;

  // A predecessor is satisfied if its event already occurred OR if the rule for
  // that predecessor projects the WO's *current* status. The latter bridges the
  // initial state: a WO starts with status PLANEJADA but no PLANEJADA event, so
  // the entry transition is still enabled.
  const satisfies = (pred: string): boolean =>
    occurred.has(pred) ||
    (rules.find((r) => r.eventType === pred && (r.woType === wo.type || r.woType === null))
      ?.projectsStatus ?? null) === wo.status;

  if (rule.predecessorRule === 'ANY' && rule.predecessors.length && !rule.predecessors.some(satisfies)) {
    return {
      ...base,
      allowed: false,
      reasonCode: 'MISSING_PREDECESSORS',
      predecessors: rule.predecessors,
      missing: rule.predecessors.filter((p) => !satisfies(p)),
    };
  }
  if (rule.predecessorRule === 'ALL' && rule.predecessors.length) {
    const missing = rule.predecessors.filter((p) => !satisfies(p));
    if (missing.length) {
      return {
        ...base,
        allowed: false,
        reasonCode: 'MISSING_PREDECESSORS',
        predecessors: rule.predecessors,
        missing,
      };
    }
  }
  return base;
}

/** Evaluate the composer's catalog against the tenant's lifecycle rules. */
export function evaluateTransitionsFromRules(
  wo: { type: string; status: string },
  catalog: EventTypeLike[],
  occurred: Set<string>,
  rules: LifecycleRule[],
): TransitionEvaluation[] {
  const relevant = catalog.filter(
    (et) => et.active !== false && (et.category === wo.type || et.category === 'ESTRUTURA'),
  );
  return relevant
    .map((et) => evaluateEventTypeFromRules(et, wo, occurred, rules))
    .sort((a, b) => Number(b.allowed) - Number(a.allowed));
}

/**
 * Project the WO status from its event log: the latest lifecycle event of the
 * WO type wins. `fallback` (default PLANEJADA) is used when there is none.
 */
export function projectStatus(
  events: Array<{ eventType: string; category: string; createdAt?: string | Date }>,
  fallback: WorkOrderStatusValue = 'PLANEJADA',
): WorkOrderStatusValue {
  let latestTs = -Infinity;
  let status: WorkOrderStatusValue = fallback;
  for (const ev of events) {
    const projected = lifecycleStateForCode(ev.eventType, ev.category);
    if (!projected) continue;
    const ts = ev.createdAt ? new Date(ev.createdAt).getTime() : 0;
    if (ts >= latestTs) {
      latestTs = ts;
      status = projected;
    }
  }
  return status;
}

/** Evaluate a single event-type against a work order's type + current status. */
export function evaluateEventType(
  et: EventTypeLike,
  wo: { type: string; status: string },
): TransitionEvaluation {
  const target = lifecycleStateForCode(et.code, et.category);
  const base: TransitionEvaluation = {
    code: et.code,
    category: et.category,
    label: et.label,
    targetStatus: target,
    allowed: true,
  };

  // Non-lifecycle markers (ESTRUTURA/OBSERVACAO/ANEXO) are never status-gated.
  if (!LIFECYCLE_CATEGORIES.has(et.category)) return base;

  // A lifecycle event must belong to the WO's own type.
  if (et.category !== wo.type) {
    return { ...base, allowed: false, reasonCode: 'TYPE_MISMATCH' };
  }

  // Terminal WOs accept no further lifecycle events.
  if (isTerminal(wo.status)) {
    return { ...base, allowed: false, reasonCode: 'TERMINAL' };
  }

  // Source-status guard.
  const suffix = suffixOf(et.code, et.category);
  const allowedFrom = ALLOWED_FROM[suffix];
  if (allowedFrom && !allowedFrom.includes(wo.status as WorkOrderStatusValue)) {
    return { ...base, allowed: false, reasonCode: 'WRONG_STATE', allowedFrom };
  }

  return base;
}

/**
 * Evaluate the catalog the composer offers (the WO type's lifecycle events +
 * ESTRUTURA markers). Allowed-first, then blocked; stable within each group.
 */
export function evaluateTransitions(
  wo: { type: string; status: string },
  catalog: EventTypeLike[],
): TransitionEvaluation[] {
  const relevant = catalog.filter(
    (et) => et.active !== false && (et.category === wo.type || et.category === 'ESTRUTURA'),
  );
  const evals = relevant.map((et) => evaluateEventType(et, wo));
  return evals.sort((a, b) => Number(b.allowed) - Number(a.allowed));
}
