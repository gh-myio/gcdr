process.env.SECRET_ENCRYPTION_KEY = process.env.SECRET_ENCRYPTION_KEY ?? 'a'.repeat(64);

import * as crypto from 'crypto';
import { CentralEnrollmentService } from '../../../src/services/CentralEnrollmentService';
import { NotFoundError, UnauthorizedError } from '../../../src/shared/errors/AppError';
import { isEnvelope, decryptSecret } from '../../../src/shared/utils/secretEnvelope';

const TENANT_ID = 't1';
const CENTRAL_ID = '22222222-2222-2222-2222-222222222222';

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Factory-of-mocks (mirrors CentralAgentService.test.ts). `opts.central`
 * overrides the row returned by getByUuid (defaults to a valid pending-token
 * row). The setEnrollToken mock echoes a row back so issue succeeds; pass
 * { central: null } to simulate an unknown central on the device path.
 */
function makeService(opts: { central?: unknown; setRow?: unknown; completeRow?: unknown } = {}) {
  const centrals = {
    setEnrollToken: jest.fn(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      async (_tenantId: string, _id: string, _hash: string, _expiresAt: Date) =>
        'setRow' in opts ? opts.setRow : { id: CENTRAL_ID, tenantId: TENANT_ID },
    ),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getByUuid: jest.fn(async (_uuid: string) =>
      'central' in opts
        ? opts.central
        : {
            id: CENTRAL_ID,
            tenantId: TENANT_ID,
            agentSecret: null,
            enrollTokenHash: null,
            enrollTokenExpiresAt: null,
            enrolledAt: null,
          },
    ),
    completeEnrollment: jest.fn(
      // CR-S8 signature: (id, expectedEnrollTokenHash, agentSecret, enrolledAt).
      // Returns null to simulate the conditional UPDATE matching zero rows.
      async (id: string, _expectedHash: string, agentSecret: string, _enrolledAt: Date) =>
        'completeRow' in opts ? opts.completeRow : { id, agentSecret },
    ),
  };
  const svc = new CentralEnrollmentService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    centrals as any,
  );
  return { svc, centrals };
}

/** Build a central row carrying a valid pending token for `plaintext`. */
function pendingTokenRow(plaintext: string, overrides: Record<string, unknown> = {}) {
  return {
    id: CENTRAL_ID,
    tenantId: TENANT_ID,
    agentSecret: null,
    enrollTokenHash: sha256Hex(plaintext),
    enrollTokenExpiresAt: new Date(Date.now() + 3600_000),
    enrolledAt: null,
    ...overrides,
  };
}

describe('CentralEnrollmentService', () => {
  describe('issueEnrollToken', () => {
    it('returns a token + expiry and stores ONLY the sha256 hash (not the plaintext)', async () => {
      const { svc, centrals } = makeService();

      const result = await svc.issueEnrollToken(TENANT_ID, CENTRAL_ID);

      expect(typeof result.enrollToken).toBe('string');
      expect(result.enrollToken.length).toBeGreaterThanOrEqual(20);
      expect(typeof result.expiresAt).toBe('string');
      // Future expiry.
      expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());

      expect(centrals.setEnrollToken).toHaveBeenCalledTimes(1);
      const [tenantArg, idArg, hashArg, expiresArg] = centrals.setEnrollToken.mock.calls[0];
      expect(tenantArg).toBe(TENANT_ID);
      expect(idArg).toBe(CENTRAL_ID);
      // The stored value is the HASH of the returned token, never the plaintext.
      expect(hashArg).toBe(sha256Hex(result.enrollToken));
      expect(hashArg).not.toBe(result.enrollToken);
      expect(expiresArg).toBeInstanceOf(Date);
    });

    it('throws NotFoundError when the central does not exist in the tenant', async () => {
      const { svc } = makeService({ setRow: null });
      await expect(svc.issueEnrollToken(TENANT_ID, CENTRAL_ID)).rejects.toThrow(NotFoundError);
    });
  });

  describe('enroll', () => {
    it('happy path: valid token returns agentSecret, persists it, and clears the token (single-use)', async () => {
      const TOKEN = 'a'.repeat(64);
      const { svc, centrals } = makeService({ central: pendingTokenRow(TOKEN) });

      const result = await svc.enroll(CENTRAL_ID, TOKEN);

      expect(typeof result.agentSecret).toBe('string');
      expect(result.agentSecret.length).toBeGreaterThan(0);
      // Persisted via completeEnrollment(uuid, agentSecret, enrolledAt). The repo
      // method is what CLEARS enroll_token_hash/expiry — assert it was called with
      // the minted secret + a timestamp.
      expect(centrals.completeEnrollment).toHaveBeenCalledTimes(1);
      const [idArg, hashArg, secretArg, enrolledAtArg] = centrals.completeEnrollment.mock.calls[0];
      expect(idArg).toBe(CENTRAL_ID);
      // CR-S8: the stored token hash is passed so the UPDATE is a single-use CAS.
      expect(hashArg).toBe(sha256Hex(TOKEN));
      // CR-S3: the STORED value is an encrypted envelope; the RETURNED secret is
      // the plaintext the device signs its poll JWT with.
      expect(isEnvelope(secretArg)).toBe(true);
      expect(decryptSecret(secretArg)).toBe(result.agentSecret);
      expect(enrolledAtArg).toBeInstanceOf(Date);
    });

    it('rejects an unknown uuid with 401, not 404 (no enumeration oracle, CR-S2)', async () => {
      const { svc, centrals } = makeService({ central: null });
      await expect(svc.enroll(CENTRAL_ID, 'a'.repeat(64))).rejects.toThrow(UnauthorizedError);
      expect(centrals.completeEnrollment).not.toHaveBeenCalled();
    });

    it('rejects when there is no pending token (already consumed / never issued)', async () => {
      const { svc, centrals } = makeService({
        central: pendingTokenRow('x'.repeat(64), { enrollTokenHash: null }),
      });
      await expect(svc.enroll(CENTRAL_ID, 'a'.repeat(64))).rejects.toThrow(UnauthorizedError);
      expect(centrals.completeEnrollment).not.toHaveBeenCalled();
    });

    it('rejects an expired token', async () => {
      const TOKEN = 'b'.repeat(64);
      const { svc, centrals } = makeService({
        central: pendingTokenRow(TOKEN, { enrollTokenExpiresAt: new Date(Date.now() - 1000) }),
      });
      await expect(svc.enroll(CENTRAL_ID, TOKEN)).rejects.toThrow(UnauthorizedError);
      expect(centrals.completeEnrollment).not.toHaveBeenCalled();
    });

    it('rejects a wrong token (hash mismatch)', async () => {
      const { svc, centrals } = makeService({ central: pendingTokenRow('c'.repeat(64)) });
      await expect(svc.enroll(CENTRAL_ID, 'WRONG'.repeat(13))).rejects.toThrow(UnauthorizedError);
      expect(centrals.completeEnrollment).not.toHaveBeenCalled();
    });

    it('re-issue + re-enroll works (field-swap: fresh token re-enables enrollment)', async () => {
      // First enroll consumes the original token.
      const TOKEN1 = 'd'.repeat(64);
      const first = makeService({ central: pendingTokenRow(TOKEN1) });
      const r1 = await first.svc.enroll(CENTRAL_ID, TOKEN1);
      expect(r1.agentSecret).toBeTruthy();

      // Operator re-issues a fresh token...
      const reissue = makeService();
      const issued = await reissue.svc.issueEnrollToken(TENANT_ID, CENTRAL_ID);

      // ...and the central enrolls again with the new token (already-enrolled row).
      const TOKEN2 = issued.enrollToken;
      const second = makeService({
        central: pendingTokenRow(TOKEN2, { enrolledAt: new Date(), agentSecret: 'old-secret' }),
      });
      const r2 = await second.svc.enroll(CENTRAL_ID, TOKEN2);

      expect(r2.agentSecret).toBeTruthy();
      // A brand-new secret is minted (not the stale one on the row).
      expect(r2.agentSecret).not.toBe('old-secret');
      expect(second.centrals.completeEnrollment).toHaveBeenCalledTimes(1);
    });

    it('uses ONE identical message for every failure (CR-S2 — no oracle in the body)', async () => {
      const messages: string[] = [];
      const collect = async (central: unknown, token: string) => {
        try {
          await makeService({ central }).svc.enroll(CENTRAL_ID, token);
        } catch (e) {
          messages.push((e as Error).message);
        }
      };
      await collect(null, 'a'.repeat(64)); // unknown uuid
      await collect(pendingTokenRow('x'.repeat(64), { enrollTokenHash: null }), 'a'.repeat(64)); // no token
      await collect(
        pendingTokenRow('y'.repeat(64), { enrollTokenExpiresAt: new Date(Date.now() - 1000) }),
        'y'.repeat(64),
      ); // expired
      await collect(pendingTokenRow('z'.repeat(64)), 'WRONG'.repeat(13)); // bad token
      expect(messages).toHaveLength(4);
      expect(new Set(messages).size).toBe(1); // every reason is indistinguishable
    });

    it('concurrent re-enroll: the loser (completeEnrollment matched 0 rows) gets 401 (CR-S8)', async () => {
      const TOKEN = 'e'.repeat(64);
      const { svc, centrals } = makeService({
        central: pendingTokenRow(TOKEN),
        completeRow: null, // the conditional CAS lost — token already consumed
      });
      await expect(svc.enroll(CENTRAL_ID, TOKEN)).rejects.toThrow(UnauthorizedError);
      expect(centrals.completeEnrollment).toHaveBeenCalledTimes(1);
    });
  });
});
