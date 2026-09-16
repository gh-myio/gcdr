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
  const data = {
    gateway: { name: 'Central Moxuara 01' },
    summary: { rulesCount: 1 },
    // FLAT shape — the custom renderer aliases each {{#each rules}} item as `rule`
    // and each {{#each rule.devices}} item as `device`, so the item objects hold
    // the fields directly (item.name, device.name). Same shape the alarm-backend
    // buildAlarmRenderContext produces; central offline just omits device.value.
    rules: [
      {
        name: 'Central offline > 150 min',
        description: 'Notifica quando a central fica sem comunicar por mais de 150 minutos',
        condition: 'offline por 150 minutos',
        emails: 'ops@moxuara.com.br, suporte@myio.com.br',
        devices: [{ name: 'Central Moxuara 01', status: 'OFFLINE', timestamp: '16/09/2026 10:42' }],
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
  console.log(`  [check] unresolved handlebars tokens: ${leftover ? leftover.join(', ') : 'none'}`);
  console.log(`  [check] has "Valor" column: ${hasValor}`);
  console.log(`  [check] device row rendered (OFFLINE cell): ${hasDeviceRow}`);
  const ok = !leftover && !hasValor && hasDeviceRow;
  console.log(`\n=== ${ok ? 'SEED+RENDER OK ✅' : 'CHECK FAILED ❌'} ===`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('ERR', e); process.exit(1); });
