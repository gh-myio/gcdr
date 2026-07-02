import * as crypto from 'crypto';

// =============================================================================
// Shared HS256 verification primitive.
//
// Both the operator JWT (AuthService) and the central-agent JWT (centralAuth)
// authenticate with the SAME scheme — HMAC-SHA256 over `${header}.${payload}`
// compared with crypto.timingSafeEqual — only the secret and the CLAIM rules
// differ (operator: exp/iss/aud; central: exp-required + iat max-age). This
// centralises the crypto so the two verifiers can't silently diverge; claim
// validation stays with each caller because it is genuinely different.
// =============================================================================

/** base64url -> Buffer (padding-tolerant). */
export function base64UrlDecode(input: string): Buffer {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = 4 - (base64.length % 4);
  if (padding !== 4) {
    base64 += '='.repeat(padding);
  }
  return Buffer.from(base64, 'base64');
}

/**
 * Verify an HS256 JWT signature over `${header}.${payload}` against `secret`
 * (constant-time) and return the decoded payload — or null if the token is
 * malformed or the signature does not match. This is the crypto boundary ONLY:
 * expiry / issuer / audience / age checks are the caller's responsibility.
 */
export function verifyHs256Signature<T>(token: string, secret: string): T | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  if (!header || !payload || !signature) return null;

  const expected = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest();
  const actual = base64UrlDecode(signature);

  if (expected.length !== actual.length) return null;
  if (!crypto.timingSafeEqual(expected, actual)) return null;

  try {
    return JSON.parse(base64UrlDecode(payload).toString('utf-8')) as T;
  } catch {
    return null;
  }
}
