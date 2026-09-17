/**
 * Local seed + render for the new EMAIL_CENTRAL_OFFLINE template (ED-1243).
 *
 * 1) upserts the template_types lookup row (so the UI dropdown shows it),
 * 2) upserts the tenant-default `central-offline-notification-v1` template,
 * 3) renders it with sample data via the REAL templateService.renderFull,
 * 4) writes the rendered HTML to scratchpad so it can be eyeballed.
 *
 * Run:  DATABASE_URL=... npx tsx scripts/dev/seed-and-render-central-offline.ts
 *   (locally the repo's .env DATABASE_URL is enough)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../src/infrastructure/database/drizzle/db';
import { templates, templateTypes } from '../../src/infrastructure/database/drizzle/schema';
import { templateService } from '../../src/services/TemplateService';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const TEST_CUSTOMER_ID = '33333333-3333-3333-3333-333333333333';
const TYPE = 'EMAIL_CENTRAL_OFFLINE';
const SLUG = 'central-offline-notification-v1';

async function main(): Promise<void> {
  const html = readFileSync(join(__dirname, 'central-offline-notification-v1.html'), 'utf8');

  // ── 1) template_types lookup row (UI dropdown label/icon) ─────────────────
  await db
    .insert(templateTypes)
    .values({ type: TYPE, label: 'Notificação de Central', description: 'E-mail de central offline (sem coluna Valor)', icon: 'router', sortOrder: 15, active: true })
    .onConflictDoUpdate({ target: templateTypes.type, set: { label: 'Notificação de Central', description: 'E-mail de central offline (sem coluna Valor)', icon: 'router', active: true, updatedAt: new Date() } });
  console.log(`  [seed] template_types '${TYPE}' upserted`);

  // ── 2) tenant-default template (clean slate on the tenant/type/slug) ──────
  await db.delete(templates).where(and(eq(templates.tenantId, TENANT_ID), eq(templates.type, TYPE), isNull(templates.customerId)));
  const [row] = await db
    .insert(templates)
    .values({ slug: SLUG, tenantId: TENANT_ID, customerId: null, name: 'Notificação de Central (Central Offline) V1', type: TYPE, status: 'ACTIVE', htmlContent: html, description: 'Template V1 de central offline — inspirado no alarme, sem a coluna Valor' })
    .returning();
  console.log(`  [seed] template '${SLUG}' inserted id=${row.id} status=${row.status} (tenant default)`);

  // ── 3) render with sample data via the real service ───────────────────────
  // FLAT / singular-aliased shape: {{#each rules}} -> rule, {{#each rule.centrals}}
  // -> central. Emails + centralsCount live in the header; the notification can
  // cover MULTIPLE centrals, each with optional mac/ipv6/uid below its label.
  const data = {
    summary: { rulesCount: 1, centralsCount: 2 },
    emails: 'ops@moxuara.com.br, suporte@myio.com.br',
    observation: 'Duas centrais sem comunicação na região; equipe de campo acionada.',
    workOrders: [
      { number: 'OS-2087', title: 'Verificar conectividade das centrais', status: 'Aberta' },
    ],
    rules: [
      {
        name: 'Central offline > 150 min',
        description: 'Notifica quando a central fica sem comunicar por mais de 150 minutos',
        condition: 'offline por 150 minutos',
        centrals: [
          { label: 'Central Loja Q303A', name: 'MOX_CENTRAL_01', status: 'OFFLINE', timestamp: '16/09/2026 10:42', mac: '00:1A:2B:3C:4D:5E', ipv6: 'fe80::1a2b:3c4d:5e6f:7a8b', uid: 'gw-7f3a1c9e' },
          { label: 'Central Subsolo', name: 'MOX_CENTRAL_02', status: 'OFFLINE', timestamp: '16/09/2026 10:55' },
        ],
      },
    ],
  };

  const result = await templateService.renderFull(TENANT_ID, TYPE, TEST_CUSTOMER_ID, data);
  console.log(`  [render] templateSource=${result.templateSource} themeSource=${result.themeSource} version=${result.template.version}`);

  const out = join(process.env.SCRATCH_DIR ?? __dirname, 'central-offline-rendered.html');
  writeFileSync(out, result.html, 'utf8');
  console.log(`  [render] wrote ${result.html.length} chars -> ${out}`);

  // sanity: no unresolved tokens, no "Valor" column, AND the device row actually rendered
  const leftover = result.html.match(/\{\{[^}]+\}\}/g);
  const hasValor = /<th[^>]*>\s*Valor\s*<\/th>/i.test(result.html);
  const hasDeviceRow = /class="status-offline">\s*OFFLINE\s*</i.test(result.html);
  const centralMeta = result.html.includes('00:1A:2B:3C:4D:5E') && result.html.includes('gw-7f3a1c9e') && (result.html.match(/MAC:/g) ?? []).length === 1;
  const multiCentral = result.html.includes('Central Loja Q303A') && result.html.includes('MOX_CENTRAL_01') && result.html.includes('Central Subsolo');
  const headerEmails = result.html.includes('ops@moxuara.com.br, suporte@myio.com.br');
  const centralsHeader = /<strong[^>]*>2<\/strong> central\(is\) offline/.test(result.html);
  const noPerRuleEmails = !result.html.includes('class="emails-row"');
  const optionalSections = result.html.includes('Observa') && result.html.includes('Ordens de Servi') && result.html.includes('OS-2087');
  console.log(`  [check] unresolved handlebars tokens: ${leftover ? leftover.join(', ') : 'none'}`);
  console.log(`  [check] has "Valor" column: ${hasValor}`);
  console.log(`  [check] central OFFLINE row rendered: ${hasDeviceRow}`);
  console.log(`  [check] optional central meta (mac/uid) shown once: ${centralMeta}`);
  console.log(`  [check] multiple centrals listed: ${multiCentral}`);
  console.log(`  [check] header emails present: ${headerEmails}`);
  console.log(`  [check] header shows total centrals offline (2): ${centralsHeader}`);
  console.log(`  [check] per-rule emails removed (only header): ${noPerRuleEmails}`);
  console.log(`  [check] optional Observação + OS sections: ${optionalSections}`);
  const ok = !leftover && !hasValor && hasDeviceRow && centralMeta && multiCentral && headerEmails && centralsHeader && noPerRuleEmails && optionalSections;
  console.log(`\n=== ${ok ? 'SEED+RENDER OK ✅' : 'CHECK FAILED ❌'} ===`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('ERR', e); process.exit(1); });
