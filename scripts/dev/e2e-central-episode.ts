/**
 * Local e2e for CENTRAL_OFFLINE episode emission (RFC-0036).
 *
 * Exercises the REAL worker code path (reconcileCentralEpisodes) against the
 * local DB, with an in-process mock ALARMS server standing in for
 * POST /incidents/episodes + POST /incidents/episodes/:id/recover. No real
 * central, no waiting for a 150-min threshold — we hand it a synthetic "past
 * offline" signal, then a "back online" signal, and assert the full lifecycle.
 *
 * Run:  DATABASE_URL=... npx tsx scripts/dev/e2e-central-episode.ts
 *   (locally the repo's .env DATABASE_URL is enough)
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../src/infrastructure/database/drizzle/db';
import { orchestratorDevicesCentralEpisodes as episodes } from '../../src/infrastructure/database/drizzle/schema';
import {
  reconcileCentralEpisodes,
  type EpisodeSignal,
  type EpisodeEmitConfig,
} from '../../src/workers/orchestrator-devices/centralEpisodes';

interface Captured { method: string; url: string; body: Record<string, unknown> | null }

async function main(): Promise<void> {
  const received: Captured[] = [];

  // ── Mock ALARMS ───────────────────────────────────────────────────────────
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const url = req.url ?? '';
      received.push({ method: req.method ?? '', url, body: raw ? JSON.parse(raw) : null });
      const json = (code: number, obj: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (req.method === 'POST' && url.endsWith('/incidents/episodes')) {
        json(201, { episodeId: 'ep-' + randomUUID(), created: true });
      } else if (req.method === 'POST' && url.startsWith('/incidents/episodes/') && url.endsWith('/recover')) {
        json(200, { alreadyRecovered: false });
      } else {
        json(404, {});
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  const apiUrl = `http://127.0.0.1:${port}`;

  const log = (l: 'info' | 'warn' | 'error', m: string, e?: Record<string, unknown>) =>
    console.log(`  [worker:${l}] ${m}`, e ?? '');
  const config: EpisodeEmitConfig = { emissionEnabled: true, apiUrl, source: 'gcdr-e2e', severity: 'HIGH' };

  const centralId = randomUUID();
  const tenantId = '11111111-1111-1111-1111-111111111111';
  const customerId = randomUUID();

  await db.delete(episodes).where(eq(episodes.centralId, centralId)); // clean slate

  let ok = true;
  const check = (name: string, cond: boolean) => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) ok = false; };

  // ── 1) central is offline past the threshold → open the episode ───────────
  console.log('\n[1] DOWN (central offline past threshold)');
  const down: EpisodeSignal = {
    centralId, tenantId, customerId,
    centralName: 'Central E2E', customerName: 'Cliente E2E',
    pastOffline: true, online: false,
    lastSuccessAt: new Date(Date.now() - 3 * 3600_000),
  };
  const r1 = await reconcileCentralEpisodes([down], config, log);
  const postDown = received.find((x) => x.method === 'POST' && x.url.endsWith('/incidents/episodes'));
  const row1 = (await db.select().from(episodes).where(eq(episodes.centralId, centralId)))[0];
  check('opened = 1', r1.opened === 1);
  check('POST /incidents/episodes received', !!postDown);
  check('body kind=CENTRAL_OFFLINE, evidence=HEARTBEAT_LOSS', postDown?.body?.kind === 'CENTRAL_OFFLINE' && postDown?.body?.evidence === 'HEARTBEAT_LOSS');
  check('body has customerId + centralId + observedAt', !!postDown?.body?.customerId && !!postDown?.body?.centralId && !!postDown?.body?.observedAt);
  check('body has enrichment centralName + customerName', postDown?.body?.centralName === 'Central E2E' && postDown?.body?.customerName === 'Cliente E2E');
  check('intent row phase=DOWN, synced=true, episodeId set', row1?.phase === 'DOWN' && row1?.synced === true && !!row1?.episodeId);

  // ── 2) central back online → recover + close ──────────────────────────────
  console.log('\n[2] ONLINE (central recovered)');
  const up: EpisodeSignal = { centralId, tenantId, customerId, centralName: 'Central E2E', customerName: 'Cliente E2E', pastOffline: false, online: true, lastSuccessAt: new Date() };
  const r2 = await reconcileCentralEpisodes([up], config, log);
  const postRecover = received.find((x) => x.method === 'POST' && x.url.endsWith('/recover'));
  const row2 = (await db.select().from(episodes).where(eq(episodes.centralId, centralId)))[0];
  check('recovered = 1', r2.recovered === 1);
  check('POST .../recover received', !!postRecover);
  check('intent row removed (episode closed)', !row2);

  await db.delete(episodes).where(eq(episodes.centralId, centralId));
  server.close();

  console.log(`\n=== ${ok ? 'E2E OK ✅' : 'E2E FAILED ❌'} — ${received.length} ALARMS calls ===`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('ERR', e); process.exit(1); });
