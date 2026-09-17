/**
 * Local seed + render for the new INCIDENT template (ingestion incident notify).
 * Proves the custom renderer handles the 4-level tree
 * customers -> gateways -> devices -> slots (flat, singular-aliased).
 *
 * Run:  npx tsx --env-file=.env scripts/dev/seed-and-render-incident.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../src/infrastructure/database/drizzle/db';
import { templates, templateTypes } from '../../src/infrastructure/database/drizzle/schema';
import { templateService } from '../../src/services/TemplateService';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const TEST_CUSTOMER_ID = '33333333-3333-3333-3333-333333333333';
const TYPE = 'INCIDENT';
const SLUG = 'incident-notification-v1';

async function main(): Promise<void> {
  const html = readFileSync(join(__dirname, 'incident-notification-v1.html'), 'utf8');

  await db
    .insert(templateTypes)
    .values({ type: TYPE, label: 'Notificação de Incidente', description: 'Incidentes do Ingestion (árvore customer→gateway→device→slot)', icon: 'alert-triangle', sortOrder: 16, active: true })
    .onConflictDoUpdate({ target: templateTypes.type, set: { label: 'Notificação de Incidente', active: true, updatedAt: new Date() } });
  console.log(`  [seed] template_types '${TYPE}' upserted`);

  await db.delete(templates).where(and(eq(templates.tenantId, TENANT_ID), eq(templates.type, TYPE), isNull(templates.customerId)));
  const [row] = await db
    .insert(templates)
    .values({ slug: SLUG, tenantId: TENANT_ID, customerId: null, name: 'Notificação de Incidente (Ingestion) V1', type: TYPE, status: 'ACTIVE', htmlContent: html, description: 'Template V1 de incidentes do Ingestion — árvore customer→gateway→device→slot, valor interpolado' })
    .returning();
  console.log(`  [seed] template '${SLUG}' inserted id=${row.id} status=${row.status}`);

  const data = {
    summary: { customersCount: 2, gatewaysCount: 3, devicesCount: 4, slotsCount: 6, detectedAt: '16/09/2026 11:20', origin: 'Agente de interpolação' },
    emails: 'admin@myio.com.br, ops@moxuara.com.br, suporte@myio.com.br',
    observation: 'Interpolação aplicada durante janela de queda de energia na região; valores estimados por regressão linear.',
    workOrders: [
      { number: 'OS-1042', title: 'Verificar alimentação da Central Moxuara 01', status: 'Aberta' },
      { number: 'OS-1043', title: 'Inspeção do medidor Outback (3F SCSMO_L2_330)', status: 'Em andamento' },
    ],
    customers: [
      {
        name: 'Moxuara Shopping',
        gateways: [
          {
            name: 'Central Moxuara 01',
            mac: '00:1A:2B:3C:4D:5E',
            ipv6: 'fe80::1a2b:3c4d:5e6f:7a8b',
            uid: 'gw-7f3a1c9e',
            devices: [
              { label: 'Outback', name: '3F SCSMO_L2_330', slots: [ { slot: '13:00', value: '450 kWh' }, { slot: '14:00', value: '470 kWh' } ] },
              { label: 'Chiller 03', name: 'SUB_CHILLER_03', slots: [ { slot: '02:00', value: '128 kWh' } ] },
            ],
          },
          {
            name: 'Central Moxuara 02',
            devices: [
              { label: 'Bomba de Incêndio', name: 'CASA_BOMBAS_01', slots: [ { slot: '03:00', value: '—' } ] },
            ],
          },
        ],
      },
      {
        name: 'Edifício Alvorada',
        gateways: [
          {
            name: 'Gateway Alvorada A',
            devices: [
              { label: 'QGBT Térreo', name: 'ALV_QGBT_T', slots: [ { slot: '10:00', value: '92 kWh' }, { slot: '11:00', value: '88 kWh' } ] },
            ],
          },
        ],
      },
    ],
  };

  const result = await templateService.renderFull(TENANT_ID, TYPE, TEST_CUSTOMER_ID, data);
  const out = join(process.env.SCRATCH_DIR ?? __dirname, 'incident-rendered.html');
  writeFileSync(out, result.html, 'utf8');
  console.log(`  [render] templateSource=${result.templateSource} wrote ${result.html.length} chars -> ${out}`);

  // checks: no unresolved tokens; all levels rendered; slot count matches
  const leftover = result.html.match(/\{\{[^}]+\}\}/g);
  const rowCount = (result.html.match(/<td class="value">/g) ?? []).length;
  const bothCustomers = result.html.includes('Moxuara Shopping') && result.html.includes('Edifício Alvorada');
  const deepDevice = result.html.includes('Outback') && result.html.includes('3F SCSMO_L2_330') && result.html.includes('QGBT Térreo') && result.html.includes('450 kWh');
  const originShown = result.html.includes('Agente de interpolação');
  const emailsShown = ['admin@myio.com.br', 'ops@moxuara.com.br', 'suporte@myio.com.br'].every((e) => result.html.includes(e));
  const noGapNoDay = !result.html.includes('leituras') && !/<th[^>]*>\s*Dia\s*<\/th>/i.test(result.html);
  // optional gateway meta: only Central Moxuara 01 has it -> exactly one MAC/IPv6/UID line
  const macShown = result.html.includes('00:1A:2B:3C:4D:5E') && (result.html.match(/MAC:/g) ?? []).length === 1
    && result.html.includes('fe80::1a2b:3c4d:5e6f:7a8b') && result.html.includes('gw-7f3a1c9e');
  console.log(`  [check] unresolved tokens: ${leftover ? leftover.join(', ') : 'none'}`);
  console.log(`  [check] value rows rendered: ${rowCount} (expected 6)`);
  console.log(`  [check] both customers present: ${bothCustomers}`);
  console.log(`  [check] deepest level (device+value) rendered: ${deepDevice}`);
  console.log(`  [check] origin shown in header: ${originShown}`);
  console.log(`  [check] all notified emails stacked: ${emailsShown}`);
  console.log(`  [check] no Dia column / no Gap text: ${noGapNoDay}`);
  console.log(`  [check] optional gateway meta (mac/ipv6/uid) shown once: ${macShown}`);
  const optionalSections = result.html.includes('Observa') && result.html.includes('Ordens de Servi') && result.html.includes('OS-1042') && result.html.includes('OS-1043');
  console.log(`  [check] optional Observação + Ordens de Serviço sections: ${optionalSections}`);
  const ok = !leftover && rowCount === 6 && bothCustomers && deepDevice && originShown && emailsShown && noGapNoDay && macShown && optionalSections;
  console.log(`\n=== ${ok ? 'INCIDENT SEED+RENDER OK ✅' : 'CHECK FAILED ❌'} ===`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('ERR', e); process.exit(1); });
