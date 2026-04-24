import { userRepository } from '../repositories/UserRepository';
import { customerRepository } from '../repositories/CustomerRepository';
import { authorizationService } from './AuthorizationService';
import {
  WikiAudience,
  WikiVisibilityPreset,
  ALL_WIKI_AUDIENCES,
} from '../domain/entities/WikiPage';

// =============================================================================
// RFC-0030: Audience Resolver
//
// Computes the effective audience set for a user (which audiences they can SEE)
// and which audience tags they can ASSIGN to a page (RBAC-gated).
// =============================================================================

export interface EffectiveAudiences {
  /**
   * The set of audiences the user is considered to belong to for the purposes
   * of reading wiki pages. A page is readable if `page.visibility && audiences`
   * is non-empty.
   */
  audiences: WikiAudience[];
  /**
   * Diagnostic metadata — surfaced via `GET /wiki/visibility/me`.
   */
  reasons: string[];
}

/**
 * Presets the UI offers as one-click choices for setting a page's visibility.
 * The resolver filters this list down to presets whose every tag the user is
 * allowed to assign.
 */
const ALL_PRESETS: WikiVisibilityPreset[] = [
  { id: 'private',              label: 'Privado (apenas minha organização)', tags: ['TENANT_PRIVATE'] },
  { id: 'myio-internal',        label: 'Somente MYIO',                        tags: ['MYIO_INTERNAL'] },
  { id: 'partners',             label: 'Somente parceiros',                   tags: ['PARTNERS'] },
  { id: 'holding-customers',    label: 'Somente clientes holding',            tags: ['HOLDING_CUSTOMERS'] },
  { id: 'non-holding-customers',label: 'Somente clientes não-holding',        tags: ['NON_HOLDING_CUSTOMERS'] },
  { id: 'all-customers',        label: 'Todos os clientes',                   tags: ['HOLDING_CUSTOMERS','NON_HOLDING_CUSTOMERS'] },
  { id: 'partners-and-customers',label:'Parceiros + clientes',                 tags: ['PARTNERS','HOLDING_CUSTOMERS','NON_HOLDING_CUSTOMERS'] },
  { id: 'public',               label: 'Público (qualquer usuário)',          tags: ['PUBLIC'] },
];

/**
 * Map an audience tag to its corresponding RBAC permission key.
 * The codebase uses `domain.function.action` with lowercase kebab-case.
 */
export function permissionForAudience(tag: WikiAudience): string {
  const kebab = tag.toLowerCase().replace(/_/g, '-');
  return `wiki.visibility.${kebab}`;
}

export class WikiAudienceResolver {

  /**
   * Compute effective audiences for a given user in a given tenant.
   * The tenant comes from req.context — this is the tenant of the *resource*
   * being accessed. If the user's own tenant matches, they gain TENANT_PRIVATE.
   */
  async resolveForUser(tenantId: string, userId: string): Promise<EffectiveAudiences> {
    const audiences: Set<WikiAudience> = new Set(['PUBLIC']);
    const reasons: string[] = ['authenticated → PUBLIC'];

    // Fetch user across tenants — a service account / INTERNAL user may live
    // in a different tenant than the resource tenant. The user repo is
    // tenant-scoped by default, so we fall back to the resource tenant for
    // normal cases.
    const user = await userRepository.getById(tenantId, userId);

    if (!user) {
      // Unknown user → only PUBLIC. This branch normally shouldn't fire
      // because auth middleware already validated the JWT, but defensively:
      reasons.push('user not resolvable in this tenant → no additional audiences');
      return { audiences: Array.from(audiences), reasons };
    }

    // Same tenant as the resource → TENANT_PRIVATE
    if (user.tenantId === tenantId) {
      audiences.add('TENANT_PRIVATE');
      reasons.push(`user.tenantId == resource tenant → TENANT_PRIVATE`);
    }

    // User type → INTERNAL / PARTNER
    if (user.type === 'INTERNAL') {
      audiences.add('MYIO_INTERNAL');
      reasons.push(`user.type == 'INTERNAL' → MYIO_INTERNAL`);
    }
    if (user.type === 'PARTNER' || user.partnerId) {
      audiences.add('PARTNERS');
      reasons.push(`user.type == 'PARTNER' or partnerId set → PARTNERS`);
    }

    // Customer type → HOLDING vs non-HOLDING
    if (user.customerId) {
      const customer = await customerRepository.getById(user.tenantId, user.customerId);
      if (customer) {
        if (customer.type === 'HOLDING') {
          audiences.add('HOLDING_CUSTOMERS');
          reasons.push(`user.customer.type == 'HOLDING' → HOLDING_CUSTOMERS`);
        } else if (
          customer.type === 'COMPANY' ||
          customer.type === 'BRANCH' ||
          customer.type === 'FRANCHISE'
        ) {
          audiences.add('NON_HOLDING_CUSTOMERS');
          reasons.push(`user.customer.type == '${customer.type}' → NON_HOLDING_CUSTOMERS`);
        }
      }
    }

    return { audiences: Array.from(audiences), reasons };
  }

  /**
   * Return which audience tags the user is allowed to ASSIGN to a page's
   * `visibility`, plus the presets whose every tag they can assign.
   *
   * The frontend uses this to drive its visibility dropdown without
   * hardcoding role logic.
   */
  async getAllowedVisibilityOptions(
    tenantId: string,
    userId: string,
  ): Promise<{ allowedTags: WikiAudience[]; presets: WikiVisibilityPreset[] }> {
    const allowedTags: WikiAudience[] = [];
    for (const tag of ALL_WIKI_AUDIENCES) {
      const res = await authorizationService.evaluatePermission(tenantId, {
        userId,
        permission: permissionForAudience(tag),
        // Scope '*' — visibility assignment is a platform-wide concern,
        // not a resource-scoped one.
        resourceScope: '*',
      });
      if (res.allowed) allowedTags.push(tag);
    }

    const allowed = new Set(allowedTags);
    const presets = ALL_PRESETS.filter((p) => p.tags.every((t) => allowed.has(t)));

    return { allowedTags, presets };
  }

  /**
   * Assert that the user is allowed to assign the given visibility set.
   * Throws ForbiddenError via the authorization service evaluation if not.
   */
  async assertCanAssignVisibility(
    tenantId: string,
    userId: string,
    visibility: WikiAudience[],
  ): Promise<{ allowed: boolean; deniedTags: WikiAudience[] }> {
    const deniedTags: WikiAudience[] = [];
    for (const tag of visibility) {
      const res = await authorizationService.evaluatePermission(tenantId, {
        userId,
        permission: permissionForAudience(tag),
        resourceScope: '*',
      });
      if (!res.allowed) deniedTags.push(tag);
    }
    return { allowed: deniedTags.length === 0, deniedTags };
  }
}

export const wikiAudienceResolver = new WikiAudienceResolver();
