// =============================================================================
// Cloudflare Turnstile server-side verification.
//
// Verifies tokens issued by the Turnstile widget on the public integration
// submission form. The widget runs on the frontend and emits a one-shot token;
// we POST it to Cloudflare to confirm the user (probably) isn't a bot.
//
// If TURNSTILE_SECRET_KEY is not configured, verification is bypassed with a
// WARN log — this keeps local/dev environments usable without Cloudflare keys.
// Production deployments MUST set the secret.
//
// Docs: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
// =============================================================================

const TURNSTILE_SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface CaptchaVerifyResult {
  success: boolean;
  /** Cloudflare error codes when verification fails. */
  errorCodes?: string[];
  /** True when verification was skipped because no secret is configured. */
  skipped?: boolean;
}

/**
 * Verify a Turnstile token. Returns { success: true } on pass, or details on
 * failure. Never throws — callers should branch on `result.success`.
 */
export async function verifyTurnstileToken(
  token: string | undefined | null,
  remoteIp?: string,
): Promise<CaptchaVerifyResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // eslint-disable-next-line no-console
    console.warn(
      '[captcha] TURNSTILE_SECRET_KEY not set — skipping verification. ' +
        'Set it in production to enforce bot protection.',
    );
    return { success: true, skipped: true };
  }

  if (!token || typeof token !== 'string' || token.length === 0) {
    return { success: false, errorCodes: ['missing-input-response'] };
  }

  const body = new URLSearchParams();
  body.append('secret', secret);
  body.append('response', token);
  if (remoteIp) body.append('remoteip', remoteIp);

  try {
    const res = await fetch(TURNSTILE_SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = (await res.json()) as {
      success: boolean;
      'error-codes'?: string[];
    };
    return {
      success: Boolean(data.success),
      errorCodes: data['error-codes'],
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[captcha] Turnstile verify request failed', err);
    return { success: false, errorCodes: ['network-error'] };
  }
}
