import { userRepository } from '../repositories/UserRepository';
import { roleAssignmentRepository } from '../repositories/RoleAssignmentRepository';
import { roleRepository } from '../repositories/RoleRepository';
import { policyRepository } from '../repositories/PolicyRepository';
import { NotFoundError } from '../shared/errors/AppError';

// =============================================================================
// WikiAccessAuditService
//
// Audits a single user's wiki write access — equivalent of running
// `scripts/db/ops/check-wiki-access-for-user.sql` programmatically.
//
// Returns a structured snapshot the frontend can render directly:
//   * user identity
//   * active role assignments (non-expired)
//   * roles + their policy keys
//   * policies with wiki.* allow/deny filtered out
//   * aggregated effective wiki.* allow + deny lists
//   * verdict per "interesting" permission (ALLOWED / DENIED / NOT_GRANTED)
//   * summary specific to POST /wiki/integrations/from-form
// =============================================================================

const REQUIRED_PERMISSIONS = [
  'wiki.page.read',
  'wiki.page.create',
  'wiki.page.update',
  'wiki.page.publish',
  'wiki.page.move',
  'wiki.page.archive',
  'wiki.page.delete',
  'wiki.namespace.read',
  'wiki.namespace.create',
  'wiki.attachment.upload',
  'wiki.visibility.public',
  'wiki.visibility.myio-internal',
  'wiki.visibility.tenant-private',
  'wiki.visibility.partners',
  'wiki.visibility.holding-customers',
  'wiki.visibility.non-holding-customers',
] as const;

export interface WikiAccessAuditUser {
  id: string;
  tenantId: string;
  email: string;
  type: string;
  customerId: string | null;
  partnerId: string | null;
  status: string;
  createdAt: string;
}

export interface WikiAccessAuditAssignment {
  roleKey: string;
  scope: string;
  status: string;
  expiresAt: string | null;
  grantedAt: string;
  grantedBy: string;
  reason: string | null;
}

export interface WikiAccessAuditRole {
  key: string;
  displayName: string;
  riskLevel: string;
  policies: string[];
  policyCount: number;
}

export interface WikiAccessAuditPolicy {
  key: string;
  displayName: string;
  riskLevel: string;
  allowWiki: string[];
  denyWiki: string[];
}

export interface WikiAccessVerdictRow {
  requiredPermission: string;
  inAllow: boolean;
  inDeny: boolean;
  verdict: 'ALLOWED' | 'DENIED' | 'NOT_GRANTED';
}

export interface WikiAccessAuditSummary {
  canCreatePage: boolean;
  canAssignPublic: boolean;
  canUseIntegrationForm: boolean;
  recommendation: string;
}

export interface WikiAccessAuditReport {
  user: WikiAccessAuditUser;
  activeRoleAssignments: WikiAccessAuditAssignment[];
  roles: WikiAccessAuditRole[];
  policies: WikiAccessAuditPolicy[];
  aggregatedWikiPermissions: { allow: string[]; deny: string[] };
  verdict: WikiAccessVerdictRow[];
  summary: WikiAccessAuditSummary;
  evaluatedAt: string;
}

/**
 * Match a target permission against a granted permission pattern.
 * Mirrors AuthorizationService.permissionMatches: segment-wise with `*`
 * wildcard per segment (domain.function.action).
 */
function permissionMatches(target: string, pattern: string): boolean {
  const [td, tf, ta] = target.split('.');
  const [pd, pf, pa] = pattern.split('.');
  if (pd !== '*' && pd !== td) return false;
  if (pf !== '*' && pf !== tf) return false;
  if (pa !== '*' && pa !== ta) return false;
  return true;
}

export class WikiAccessAuditService {

  async auditUser(tenantId: string, userId: string): Promise<WikiAccessAuditReport> {
    // 1) User
    const user = await userRepository.getById(tenantId, userId);
    if (!user) {
      throw new NotFoundError(`User ${userId} not found in tenant ${tenantId}`);
    }

    // 2) Active assignments
    const assignments = await roleAssignmentRepository.getActiveByUserId(tenantId, userId);

    const roleKeys = [...new Set(assignments.map((a) => a.roleKey))];
    const roles = roleKeys.length > 0
      ? await roleRepository.getByKeys(tenantId, roleKeys)
      : [];

    const policyKeys = [...new Set(roles.flatMap((r) => r.policies))];
    const policies = policyKeys.length > 0
      ? await policyRepository.getByKeys(tenantId, policyKeys)
      : [];

    // 3) Aggregate wiki.* perms (deny wins over allow)
    const allowSet = new Set<string>();
    const denySet  = new Set<string>();
    for (const p of policies) {
      for (const perm of p.allow) {
        if (perm.startsWith('wiki.') || perm.startsWith('wiki')) allowSet.add(perm);
      }
      for (const perm of p.deny) {
        if (perm.startsWith('wiki.') || perm.startsWith('wiki')) denySet.add(perm);
      }
    }
    const allowList = [...allowSet].sort();
    const denyList  = [...denySet].sort();

    // 4) Per-policy summary (with wiki.* filtered)
    const policiesView: WikiAccessAuditPolicy[] = policies.map((p) => ({
      key:         p.key,
      displayName: p.displayName,
      riskLevel:   p.riskLevel,
      allowWiki:   p.allow.filter((s) => s.startsWith('wiki.') || s.startsWith('wiki')),
      denyWiki:    p.deny.filter((s)  => s.startsWith('wiki.') || s.startsWith('wiki')),
    }));

    const rolesView: WikiAccessAuditRole[] = roles.map((r) => ({
      key:         r.key,
      displayName: r.displayName,
      riskLevel:   r.riskLevel,
      policies:    r.policies,
      policyCount: r.policies.length,
    }));

    const assignmentsView: WikiAccessAuditAssignment[] = assignments.map((a) => ({
      roleKey:    a.roleKey,
      scope:      a.scope,
      status:     a.status,
      expiresAt:  a.expiresAt ?? null,
      grantedAt:  a.grantedAt,
      grantedBy:  a.grantedBy,
      reason:     a.reason ?? null,
    }));

    // 5) Verdict per required permission
    const verdict: WikiAccessVerdictRow[] = REQUIRED_PERMISSIONS.map((target) => {
      const inAllow = allowList.some((p) => permissionMatches(target, p));
      const inDeny  = denyList.some((p)  => permissionMatches(target, p));
      const v: WikiAccessVerdictRow['verdict'] =
        inDeny  ? 'DENIED'
        : inAllow ? 'ALLOWED'
        : 'NOT_GRANTED';
      return { requiredPermission: target, inAllow, inDeny, verdict: v };
    });

    // 6) Summary for POST /wiki/integrations/from-form
    const verdictByPerm = new Map(verdict.map((v) => [v.requiredPermission, v]));
    const canCreatePage   = verdictByPerm.get('wiki.page.create')!.verdict === 'ALLOWED';
    const canAssignPublic = verdictByPerm.get('wiki.visibility.public')!.verdict === 'ALLOWED';
    const canUseIntegrationForm = canCreatePage && canAssignPublic;

    let recommendation: string;
    if (canUseIntegrationForm) {
      recommendation =
        'OK — usuário pode chamar POST /wiki/integrations/from-form e publicar com PUBLIC.';
    } else if (canCreatePage && !canAssignPublic) {
      recommendation =
        'PARCIAL — pode criar páginas mas será bloqueado por ForbiddenError ao tentar PUBLIC. ' +
        'Atribua role com policy:wiki-myio-admin (ou crie role com wiki.visibility.public).';
    } else {
      recommendation =
        'BLOQUEADO — falta wiki.page.create. Atribua role com policy:wiki-author (ou superior).';
    }

    return {
      user: {
        id:         user.id,
        tenantId:   user.tenantId,
        email:      user.email,
        type:       user.type,
        customerId: user.customerId ?? null,
        partnerId:  user.partnerId ?? null,
        status:     user.status,
        createdAt:  user.createdAt,
      },
      activeRoleAssignments:     assignmentsView,
      roles:                     rolesView,
      policies:                  policiesView,
      aggregatedWikiPermissions: { allow: allowList, deny: denyList },
      verdict,
      summary: {
        canCreatePage,
        canAssignPublic,
        canUseIntegrationForm,
        recommendation,
      },
      evaluatedAt: new Date().toISOString(),
    };
  }
}

export const wikiAccessAuditService = new WikiAccessAuditService();
