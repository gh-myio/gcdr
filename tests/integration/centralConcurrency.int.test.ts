/**
 * CR-B4 — real-PostgreSQL concurrency tests for the central-agent guarantees.
 *
 * GATED: only runs when INTEGRATION_DATABASE_URL is set (e.g. the local
 * docker-compose.db-local.yml on :5544, schema applied via `npm run db:push`).
 * Without it the suite is skipped, so CI without a DB stays green.
 *
 *   INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@localhost:5544/db_gcdr \
 *     npx jest tests/integration/centralConcurrency.int.test.ts
 *
 * Proves what the unit tests can only assert by SQL-shape/mock:
 *   (a) two concurrent claimNextQueued hand out DISTINCT jobs (FOR UPDATE SKIP
 *       LOCKED), never the same one;
 *   (b) two concurrent enroll() of the same token → exactly ONE succeeds
 *       (completeEnrollment's conditional compare-and-swap, CR-S8).
 */
process.env.DATABASE_URL = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.SECRET_ENCRYPTION_KEY = process.env.SECRET_ENCRYPTION_KEY ?? 'a'.repeat(64);

import * as crypto from 'crypto';
import postgres from 'postgres';
import { CentralRestoreJobRepository } from '../../src/repositories/CentralRestoreJobRepository';
import { CentralEnrollmentService } from '../../src/services/CentralEnrollmentService';

const HAS_DB = !!process.env.INTEGRATION_DATABASE_URL;
const describeDb = HAS_DB ? describe : describe.skip;

const TENANT = '11111111-1111-1111-1111-111111111111';
const CENTRAL = '22222222-2222-2222-2222-222222222222';
const sha256Hex = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

describeDb('central concurrency on real PG (CR-B4)', () => {
  // Dedicated single-connection client so `SET session_replication_role` (which
  // lets us seed a central without seeding its customer/asset FK parents)
  // persists across the seed statements.
  let seed: ReturnType<typeof postgres>;

  beforeAll(() => {
    seed = postgres(process.env.INTEGRATION_DATABASE_URL as string, { max: 1 });
  });
  afterAll(async () => {
    await seed.end({ timeout: 5 });
  });

  async function resetAndSeedCentral(): Promise<void> {
    await seed`SET session_replication_role = 'replica'`;
    await seed`DELETE FROM central_restore_jobs WHERE tenant_id = ${TENANT}`;
    await seed`DELETE FROM central_backups WHERE tenant_id = ${TENANT}`;
    await seed`DELETE FROM centrals WHERE id = ${CENTRAL}`;
    await seed`
      INSERT INTO centrals
        (id, tenant_id, customer_id, asset_id, name, display_name, serial_number,
         type, firmware_version, software_version)
      VALUES
        (${CENTRAL}, ${TENANT}, gen_random_uuid(), gen_random_uuid(), 'itest',
         'itest', 'SN-ITEST', 'NODEHUB', '1.0.0', '1.0.0')`;
  }

  it('(a) two concurrent claims hand out distinct jobs (FOR UPDATE SKIP LOCKED)', async () => {
    await resetAndSeedCentral();
    const backupId = crypto.randomUUID();
    await seed`
      INSERT INTO central_backups (id, tenant_id, central_id, storage_key, bucket, status)
      VALUES (${backupId}, ${TENANT}, ${CENTRAL}, ${'backups/itest/' + backupId}, 'b', 'AVAILABLE')`;
    const jobA = crypto.randomUUID();
    const jobB = crypto.randomUUID();
    for (const id of [jobA, jobB]) {
      await seed`
        INSERT INTO central_restore_jobs
          (id, tenant_id, central_id, source_backup_id, status, current_phase)
        VALUES (${id}, ${TENANT}, ${CENTRAL}, ${backupId}, 'QUEUED', 'QUEUED')`;
    }

    const repo = new CentralRestoreJobRepository();
    const [c1, c2] = await Promise.all([
      repo.claimNextQueued(TENANT, CENTRAL),
      repo.claimNextQueued(TENANT, CENTRAL),
    ]);

    expect(c1).not.toBeNull();
    expect(c2).not.toBeNull();
    expect(c1!.id).not.toBe(c2!.id); // distinct jobs, never the same
    expect(new Set([c1!.id, c2!.id])).toEqual(new Set([jobA, jobB]));
    expect(c1!.status).toBe('RUNNING');
    expect(c2!.status).toBe('RUNNING');
  });

  it('(b) two concurrent enrolls of the same token → exactly one succeeds (CR-S8)', async () => {
    await resetAndSeedCentral();
    const TOKEN = 'e'.repeat(64);
    await seed`
      UPDATE centrals
         SET enroll_token_hash = ${sha256Hex(TOKEN)},
             enroll_token_expires_at = now() + interval '1 hour'
       WHERE id = ${CENTRAL}`;

    const svc = new CentralEnrollmentService();
    const results = await Promise.allSettled([
      svc.enroll(CENTRAL, TOKEN),
      svc.enroll(CENTRAL, TOKEN),
    ]);

    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1); // single-use: exactly one winner
    expect(failed).toHaveLength(1);

    // The token is consumed (cleared) after the winning enroll.
    const [row] = await seed`SELECT enroll_token_hash FROM centrals WHERE id = ${CENTRAL}`;
    expect(row.enroll_token_hash).toBeNull();
  });
});
