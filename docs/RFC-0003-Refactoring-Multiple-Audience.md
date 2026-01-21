# RFC-0003: JWT Multiple Audience Support for Cross-Service Authentication

- Feature Name: `jwt_multiple_audience`
- Start Date: 2026-01-21
- RFC PR: N/A
- Status: Implemented

## Summary

This RFC proposes implementing multiple audience (`aud`) claim support in JWT tokens emitted by GCDR, allowing tokens to be validated by multiple downstream services (GCDR API and Alarm Orchestrator) without requiring separate authentication flows.

## Motivation

Currently, GCDR emits JWT tokens with a single audience claim (`aud: "gcdr-api"`). When integrating with the Alarm Orchestrator service, tokens need to be valid for both services. Without multiple audience support, we face two undesirable options:

1. **Separate tokens**: Require the frontend to obtain different tokens for each service
2. **Ignore audience validation**: Weaken security by skipping audience validation in downstream services

Multiple audience support in JWT is standardized in [RFC 7519 Section 4.1.3](https://datatracker.ietf.org/doc/html/rfc7519#section-4.1.3), which explicitly states that the `aud` claim "MAY" be an array of case-sensitive strings.

## Guide-level Explanation

### For Frontend Developers

No changes required. The authentication flow remains the same:

1. User logs in via GCDR `/auth/login` endpoint
2. Frontend receives a JWT access token
3. The same token works for both GCDR API and Alarm Orchestrator API

### For Backend Developers

The JWT `aud` claim changes from a string to an array:

**Before:**
```json
{
  "sub": "user-123",
  "tenant_id": "tenant-abc",
  "aud": "gcdr-api",
  "iss": "gcdr",
  "exp": 1737500000
}
```

**After:**
```json
{
  "sub": "user-123",
  "tenant_id": "tenant-abc",
  "aud": ["gcdr-api", "alarm-orchestrator"],
  "iss": "gcdr",
  "exp": 1737500000
}
```

### Environment Configuration

GCDR (Identity Provider):
```env
JWT_SECRET=your-shared-secret-here
JWT_ISSUER=gcdr
JWT_AUDIENCE=gcdr-api,alarm-orchestrator
```

Alarm Orchestrator (Resource Server):
```env
JWT_SECRET=your-shared-secret-here  # Same secret as GCDR
JWT_ISSUER=gcdr                     # Same issuer as GCDR
JWT_AUDIENCE=alarm-orchestrator     # This service's identifier
```

## Reference-level Explanation

### Token Issuance (GCDR)

The `JWT_AUDIENCE` environment variable now accepts comma-separated values:

```typescript
// AuthService.ts - createJWT function
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'gcdr-api';

// Parse audience: supports both single string and comma-separated list
function parseAudience(audience: string): string | string[] {
  const parts = audience.split(',').map(s => s.trim()).filter(Boolean);
  return parts.length === 1 ? parts[0] : parts;
}

// JWT payload
const fullPayload = {
  ...payload,
  iat: now,
  exp: now + expiresIn,
  iss: JWT_ISSUER,
  aud: parseAudience(JWT_AUDIENCE),
};
```

### Token Validation (Alarm Orchestrator)

The auth middleware validates that the token's audience contains the expected value:

```typescript
// auth.middleware.ts - verifyJWT function
interface JWTPayload {
  // ... other fields
  aud: string | string[];
}

function verifyAudience(tokenAud: string | string[], expectedAud: string): boolean {
  if (Array.isArray(tokenAud)) {
    return tokenAud.includes(expectedAud);
  }
  return tokenAud === expectedAud;
}

// In verifyJWT:
if (!verifyAudience(payload.aud, env.JWT_AUDIENCE)) {
  return null;
}
```

### Security Considerations

1. **Shared Secret**: Both services MUST use the same `JWT_SECRET` for HS256 signature verification
2. **Issuer Validation**: Both services SHOULD validate `iss` claim matches expected issuer
3. **Audience Scoping**: Only include audiences for services that should accept the token
4. **Token Expiration**: Standard expiration validation remains unchanged

### Migration Path

1. **Phase 1 (GCDR)**: Update `createJWT` to support array audiences
2. **Phase 2 (Alarm Orchestrator)**: Update `verifyJWT` to accept array audiences
3. **Phase 3 (Deploy)**: Update environment variables with comma-separated audiences

Both changes are backwards compatible:
- Old tokens (string audience) will continue to work
- New tokens (array audience) work with updated validators

## Drawbacks

1. **Slightly larger token size**: Array format adds a few bytes to token payload
2. **Shared secret management**: Services must coordinate secret rotation

## Rationale and Alternatives

### Why Multiple Audience (Option A)?

- **Standards compliant**: RFC 7519 explicitly supports array audiences
- **Simple implementation**: Minimal code changes required
- **Single token**: Frontend uses one token for all services
- **No additional infrastructure**: No token exchange service needed

### Alternatives Considered

**Option B: Token Exchange (RFC 8693)**
- Pros: Better security isolation, service-specific tokens
- Cons: Requires additional infrastructure, more complex flow, higher latency

**Option C: Shared Audience**
- Pros: Simplest implementation
- Cons: Less secure, can't distinguish between services

**Option D: Proxy Authentication**
- Pros: Single authentication point
- Cons: Single point of failure, added latency

## Prior Art

- [RFC 7519 - JSON Web Token (JWT)](https://datatracker.ietf.org/doc/html/rfc7519#section-4.1.3)
- [Auth0 Multi-Audience Tokens](https://auth0.com/docs/secure/tokens/access-tokens/json-web-tokens#audience)
- [Google Cloud Platform Identity Tokens](https://cloud.google.com/docs/authentication/token-types)

## Unresolved Questions

1. Should we implement audience-specific scopes/permissions in the future?
2. Should we add a `services` claim to explicitly list allowed services?

## Future Possibilities

1. **Per-service permissions**: Add service-specific scopes to tokens
2. **Token exchange**: Implement RFC 8693 for service-to-service auth
3. **mTLS**: Add mutual TLS for service authentication
4. **JWT profiles**: Support different token profiles for different use cases

---

## Implementation Checklist

- [x] Update GCDR `AuthService.ts` to emit array audiences
- [x] Update GCDR `JWTPayload` interface to support `string | string[]`
- [x] Update Alarm Orchestrator `auth.middleware.ts` to validate array audiences
- [x] Update Alarm Orchestrator `JWTPayload` interface
- [ ] Update environment variables in deployment configurations
- [ ] Document shared secret management procedures
