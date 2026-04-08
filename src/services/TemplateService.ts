import { Template, TemplateSummary, TemplateType } from '../domain/entities/Template';
import { CreateTemplateDTO, UpdateTemplateDTO, ListTemplatesQuery } from '../dto/request/TemplateDTO';
import { TemplateRepository } from '../repositories/TemplateRepository';
import { ITemplateRepository } from '../repositories/interfaces/ITemplateRepository';
import { lookAndFeelRepository } from '../repositories/LookAndFeelRepository';
import { CustomerRepository } from '../repositories/CustomerRepository';
import { LookAndFeel } from '../domain/entities/LookAndFeel';
import { ConflictError, NotFoundError, AppError } from '../shared/errors/AppError';

const customerRepo = new CustomerRepository();

// Tenant/customer da plataforma MYIO — usado como fallback de tema
const MYIO_TENANT_ID  = '11111111-1111-1111-1111-111111111111';
const MYIO_CUSTOMER_ID = '22222222-2222-2222-2222-222222222222';

// =============================================================================
// Template Tag Catalog — per type
// =============================================================================

export interface TagDefinition {
  tag: string;
  label: string;
  description: string;
  example: string;
}

const TAG_CATALOG: Record<string, TagDefinition[]> = {
  EMAIL_ALARM: [
    { tag: '{{summary.rulesCount}}',     label: 'Qtd. de rules disparadas',        description: 'Número total de rules que dispararam no evento',              example: '3' },
    { tag: '{{summary.devicesCount}}',   label: 'Qtd. de dispositivos alarmados',  description: 'Número total de dispositivos afetados',                      example: '7' },
    { tag: '{{gateway.name}}',           label: 'Nome do gateway',                 description: 'Nome do gateway que originou o alarme',                      example: 'MessageGatewayMestreAlvaro' },
    { tag: '{{gateway.type}}',           label: 'Tipo do gateway',                 description: 'Tipo do gateway',                                            example: 'MESSAGE_GATEWAY' },
    { tag: '{{#each rules}}',            label: 'Loop — abre bloco de rules',      description: 'Repete o bloco HTML para cada rule disparada',               example: '' },
    { tag: '{{rule.name}}',              label: 'Nome da rule',                    description: 'Dentro de {{#each rules}}',                                  example: 'Fancoil Ligado Fora do Horario' },
    { tag: '{{rule.description}}',       label: 'Descrição da rule',               description: 'Dentro de {{#each rules}}',                                  example: 'Fancoil permanece ligado fora do horario' },
    { tag: '{{rule.condition}}',         label: 'Condição da rule',                description: 'Dentro de {{#each rules}}',                                  example: 'Valor > 100' },
    { tag: '{{rule.emails}}',            label: 'Emails notificados',              description: 'Dentro de {{#each rules}} — lista separada por vírgula',     example: 'rodrigo@myio.com.br, victor@myio.com.br' },
    { tag: '{{#each rule.devices}}',     label: 'Loop — abre bloco de devices',    description: 'Dentro de {{#each rules}} — repete para cada device',        example: '' },
    { tag: '{{device.name}}',            label: 'Nome do device',                  description: 'Dentro de {{#each rule.devices}}',                           example: 'Fancoil Sala Reuniao 01' },
    { tag: '{{device.value}}',           label: 'Valor medido',                    description: 'Dentro de {{#each rule.devices}}',                           example: '450' },
    { tag: '{{device.status}}',          label: 'Status do device',               description: "Dentro de {{#each rule.devices}} — 'online' ou 'offline'",   example: 'online' },
    { tag: '{{device.timestamp}}',       label: 'Data/hora do alarme',             description: 'Dentro de {{#each rule.devices}}',                           example: '05/03/2026 10:54:45' },
    { tag: '{{/each}}',                  label: 'Loop — fecha bloco',              description: 'Fecha {{#each rules}} ou {{#each rule.devices}}',            example: '' },
  ],
  EMAIL_REPORT: [
    { tag: '{{report.title}}',           label: 'Título do relatório',             description: 'Nome do relatório gerado',                                   example: 'Relatório Mensal - Março 2026' },
    { tag: '{{report.period}}',          label: 'Período do relatório',            description: 'Período de referência',                                      example: '01/03/2026 a 31/03/2026' },
    { tag: '{{report.generatedAt}}',     label: 'Data de geração',                 description: 'Data/hora em que o relatório foi gerado',                    example: '05/03/2026 08:00:00' },
    { tag: '{{customer.name}}',          label: 'Nome do cliente',                 description: 'Nome do customer associado ao relatório',                    example: 'Dimension Engenharia' },
    { tag: '{{summary.totalAlarms}}',    label: 'Total de alarmes',                description: 'Total de alarmes no período',                                example: '42' },
    { tag: '{{summary.activeDevices}}',  label: 'Dispositivos ativos',             description: 'Dispositivos ativos no período',                             example: '128' },
    { tag: '{{#each items}}',            label: 'Loop — itens do relatório',       description: 'Repete para cada item/linha do relatório',                   example: '' },
    { tag: '{{item.label}}',             label: 'Rótulo do item',                  description: 'Dentro de {{#each items}}',                                  example: 'Energia Total' },
    { tag: '{{item.value}}',             label: 'Valor do item',                   description: 'Dentro de {{#each items}}',                                  example: '12.450 kWh' },
    { tag: '{{/each}}',                  label: 'Loop — fecha bloco',              description: 'Fecha qualquer {{#each}}',                                   example: '' },
  ],
  EMAIL_WELCOME: [
    { tag: '{{user.name}}',              label: 'Nome do usuário',                 description: 'Nome completo do novo usuário',                              example: 'João Silva' },
    { tag: '{{user.email}}',             label: 'Email do usuário',                description: 'Email de login do usuário',                                  example: 'joao@empresa.com' },
    { tag: '{{customer.name}}',          label: 'Nome da empresa',                 description: 'Nome do customer ao qual o usuário pertence',                example: 'Dimension Engenharia' },
    { tag: '{{platform.name}}',          label: 'Nome da plataforma',              description: 'Nome da plataforma MYIO',                                    example: 'MYIO' },
    { tag: '{{platform.url}}',           label: 'URL da plataforma',               description: 'Link de acesso à plataforma',                                example: 'https://app.myio.com.br' },
    { tag: '{{activation.link}}',        label: 'Link de ativação',                description: 'Link para o usuário definir senha e ativar a conta',         example: 'https://app.myio.com.br/activate?token=xxx' },
    { tag: '{{activation.expiresAt}}',   label: 'Expiração do link',               description: 'Data/hora de expiração do link de ativação',                 example: '07/03/2026 18:00:00' },
  ],
  RELEASE_NOTE: [
    { tag: '{{version}}',                label: 'Versão da release',               description: 'Número de versão do release',                                example: 'v0.1.428' },
    { tag: '{{period}}',                 label: 'Período/mês',                     description: 'Mês e ano da release',                                       example: 'Março 2026' },
    { tag: '{{moduleName}}',             label: 'Nome do módulo',                  description: 'Módulo ao qual a feature pertence',                          example: 'Módulo de Energia' },
    { tag: '{{featureTitle}}',           label: 'Título da feature',               description: 'Título principal da nova funcionalidade',                    example: 'Exportação de Dados em PDF, XLS e CSV' },
    { tag: '{{featureSubtitle}}',        label: 'Subtítulo da feature',            description: 'Descrição resumida da feature',                              example: 'Disponível no topo de cada painel' },
    { tag: '{{overviewText}}',           label: 'Texto de visão geral',            description: 'Parágrafo descritivo da funcionalidade',                     example: 'O MYIO agora permite exportar dados...' },
    { tag: '{{highlightPanelLabel}}',    label: 'Label do painel em destaque',     description: 'Nome e contagem do painel principal exibido à direita',      example: 'Coluna Área Comum — 69 dispositivos' },
    { tag: '{{highlightMetric}}',        label: 'Métrica em destaque',             description: 'Valor numérico destacado no painel direito',                 example: '48.932 MWh' },
    { tag: '{{#each formats}}',          label: 'Loop — formatos disponíveis',     description: 'Itera sobre lista de formatos (PDF, XLS, CSV)',              example: '' },
    { tag: '{{format.label}}',           label: 'Label do formato',                description: 'Dentro de {{#each formats}}',                                example: 'PDF' },
    { tag: '{{format.description}}',     label: 'Descrição do formato',            description: 'Dentro de {{#each formats}}',                                example: 'Relatório visual formatado' },
    { tag: '{{#each panels}}',           label: 'Loop — painéis',                  description: 'Itera sobre painéis com exportação',                         example: '' },
    { tag: '{{panel.name}}',             label: 'Nome do painel',                  description: 'Dentro de {{#each panels}}',                                 example: 'Área Comum' },
    { tag: '{{panel.deviceCount}}',      label: 'Qtd. de dispositivos',            description: 'Dentro de {{#each panels}}',                                 example: '69' },
    { tag: '{{#each steps}}',            label: 'Loop — passos de uso',            description: 'Itera sobre os passos do guia de uso',                       example: '' },
    { tag: '{{step.number}}',            label: 'Número do passo',                 description: 'Dentro de {{#each steps}}',                                  example: '1' },
    { tag: '{{step.text}}',              label: 'Texto do passo',                  description: 'Dentro de {{#each steps}}',                                  example: 'Acesse o painel desejado' },
    { tag: '{{#each highlights}}',       label: 'Loop — destaques/métricas',       description: 'Itera sobre itens de destaque no painel direito',            example: '' },
    { tag: '{{highlight.label}}',        label: 'Label do destaque',               description: 'Dentro de {{#each highlights}}',                             example: 'CHILLER 1' },
    { tag: '{{highlight.value}}',        label: 'Valor do destaque',               description: 'Dentro de {{#each highlights}}',                             example: '12.429 MWh' },
    { tag: '{{highlight.description}}',  label: 'Descrição do destaque',           description: 'Dentro de {{#each highlights}}',                             example: '25.4% do total' },
    { tag: '{{/each}}',                  label: 'Loop — fecha bloco',              description: 'Fecha qualquer {{#each}}',                                   example: '' },
  ],
  NOTIFICATION: [
    { tag: '{{notification.title}}',     label: 'Título da notificação',           description: 'Título principal da notificação',                            example: 'Alarme crítico detectado' },
    { tag: '{{notification.body}}',      label: 'Corpo da notificação',            description: 'Texto completo da mensagem',                                 example: 'O dispositivo Fancoil 01 excedeu o limite configurado.' },
    { tag: '{{notification.level}}',     label: 'Nível de severidade',             description: 'INFO | WARNING | ERROR | SUCCESS',                           example: 'WARNING' },
    { tag: '{{notification.actionLabel}}', label: 'Label do botão de ação',        description: 'Texto do CTA da notificação',                                example: 'Ver detalhes' },
    { tag: '{{notification.actionUrl}}', label: 'URL da ação',                     description: 'Link para onde o botão de ação aponta',                      example: 'https://app.myio.com.br/alarms/123' },
    { tag: '{{user.name}}',              label: 'Nome do usuário',                 description: 'Nome do destinatário da notificação',                        example: 'João Silva' },
    { tag: '{{customer.name}}',          label: 'Nome do cliente',                 description: 'Nome do customer associado',                                 example: 'Dimension Engenharia' },
    { tag: '{{platform.name}}',          label: 'Nome da plataforma',              description: 'Nome da plataforma MYIO',                                    example: 'MYIO' },
  ],
  TELEGRAM_ALARM_OPENED: [
    { tag: '{{alarm.id}}',             label: 'ID do alarme',            description: 'Identificador único do alarme',                                  example: 'a1b2c3d4-...' },
    { tag: '{{alarm.title}}',          label: 'Título do alarme',        description: 'Título descritivo da rule que disparou',                         example: 'Temperatura Elevada — Sala de Máquinas' },
    { tag: '{{alarm.description}}',    label: 'Descrição do alarme',     description: 'Descrição adicional da rule (opcional)',                         example: 'Temperatura acima do limite operacional' },
    { tag: '{{alarm.severity}}',       label: 'Severidade',              description: 'CRITICAL | HIGH | MEDIUM | LOW',                                 example: 'HIGH' },
    { tag: '{{alarm.raisedAt}}',       label: 'Data/hora de abertura',   description: 'Quando o alarme foi aberto',                                     example: '17/03/2026 10:22:00' },
    { tag: '{{customer.name}}',        label: 'Nome do cliente',         description: 'Nome do customer associado ao alarme',                           example: 'Mestre Álvaro' },
    { tag: '{{device.name}}',          label: 'Nome do dispositivo',     description: 'Nome do dispositivo que disparou o alarme',                      example: 'Sensor Temp SM-01' },
    { tag: '{{device.value}}',         label: 'Valor medido',            description: 'Valor no momento do disparo',                                    example: '78' },
    { tag: '{{device.unit}}',          label: 'Unidade',                 description: 'Unidade da medida (opcional)',                                   example: '°C' },
  ],
  TELEGRAM_ALARM_CLOSED: [
    { tag: '{{alarm.id}}',             label: 'ID do alarme',            description: 'Identificador único do alarme',                                  example: 'a1b2c3d4-...' },
    { tag: '{{alarm.title}}',          label: 'Título do alarme',        description: 'Título da rule',                                                 example: 'Temperatura Elevada — Sala de Máquinas' },
    { tag: '{{alarm.raisedAt}}',       label: 'Data/hora de abertura',   description: 'Quando o alarme foi aberto',                                     example: '17/03/2026 10:22:00' },
    { tag: '{{alarm.closedAt}}',       label: 'Data/hora de fechamento', description: 'Quando o alarme foi resolvido',                                  example: '17/03/2026 10:45:00' },
    { tag: '{{alarm.resolution}}',     label: 'Resolução',               description: 'Texto de resolução (opcional)',                                  example: 'Equipamento reiniciado' },
    { tag: '{{customer.name}}',        label: 'Nome do cliente',         description: 'Nome do customer',                                               example: 'Mestre Álvaro' },
    { tag: '{{device.name}}',          label: 'Nome do dispositivo',     description: 'Dispositivo que gerou o alarme',                                 example: 'Sensor Temp SM-01' },
  ],
  TELEGRAM_ALARM_ESCALATED: [
    { tag: '{{alarm.id}}',             label: 'ID do alarme',            description: 'Identificador único do alarme',                                  example: 'a1b2c3d4-...' },
    { tag: '{{alarm.title}}',          label: 'Título do alarme',        description: 'Título da rule',                                                 example: 'Temperatura Elevada — Sala de Máquinas' },
    { tag: '{{alarm.escalationLevel}}',label: 'Nível de escalação',      description: 'Nível atual de escalação (1, 2, ...)',                           example: '1' },
    { tag: '{{alarm.raisedAt}}',       label: 'Data/hora de abertura',   description: 'Quando o alarme foi aberto',                                     example: '17/03/2026 10:22:00' },
    { tag: '{{alarm.escalatedAt}}',    label: 'Data/hora de escalação',  description: 'Quando a escalação foi disparada',                               example: '17/03/2026 10:27:00' },
    { tag: '{{alarm.dispatchCount}}',  label: 'Notificações anteriores', description: 'Quantas notificações já foram enviadas para este alarme',        example: '2' },
    { tag: '{{customer.name}}',        label: 'Nome do cliente',         description: 'Nome do customer',                                               example: 'Mestre Álvaro' },
    { tag: '{{device.name}}',          label: 'Nome do dispositivo',     description: 'Dispositivo que gerou o alarme',                                 example: 'Sensor Temp SM-01' },
  ],
  TELEGRAM_ALARM_ACKNOWLEDGED: [
    { tag: '{{alarm.id}}',             label: 'ID do alarme',            description: 'Identificador único do alarme',                                  example: 'a1b2c3d4-...' },
    { tag: '{{alarm.title}}',          label: 'Título do alarme',        description: 'Título da rule',                                                 example: 'Temperatura Elevada — Sala de Máquinas' },
    { tag: '{{alarm.raisedAt}}',       label: 'Data/hora de abertura',   description: 'Quando o alarme foi aberto',                                     example: '17/03/2026 10:22:00' },
    { tag: '{{alarm.acknowledgedAt}}', label: 'Data/hora de ACK',        description: 'Quando o alarme foi reconhecido',                                example: '17/03/2026 10:25:00' },
    { tag: '{{alarm.notes}}',          label: 'Observações',             description: 'Texto livre de observação ao reconhecer (opcional)',             example: 'Técnico a caminho' },
    { tag: '{{acknowledgedBy}}',       label: 'Reconhecido por',         description: 'Nome ou e-mail de quem fez o ACK',                               example: 'João Silva' },
    { tag: '{{customer.name}}',        label: 'Nome do cliente',         description: 'Nome do customer',                                               example: 'Mestre Álvaro' },
    { tag: '{{device.name}}',          label: 'Nome do dispositivo',     description: 'Dispositivo que gerou o alarme',                                 example: 'Sensor Temp SM-01' },
  ],
  TELEGRAM_ALARM_SNOOZED: [
    { tag: '{{alarm.id}}',             label: 'ID do alarme',            description: 'Identificador único do alarme',                                  example: 'a1b2c3d4-...' },
    { tag: '{{alarm.title}}',          label: 'Título do alarme',        description: 'Título da rule',                                                 example: 'Temperatura Elevada — Sala de Máquinas' },
    { tag: '{{alarm.raisedAt}}',       label: 'Data/hora de abertura',   description: 'Quando o alarme foi aberto',                                     example: '17/03/2026 10:22:00' },
    { tag: '{{alarm.snoozedAt}}',      label: 'Data/hora de snooze',     description: 'Quando o silêncio foi ativado',                                  example: '17/03/2026 10:26:00' },
    { tag: '{{alarm.silencedUntil}}',  label: 'Retomar em',              description: 'Data/hora em que o alarme volta a notificar',                    example: '17/03/2026 11:00:00' },
    { tag: '{{alarm.reason}}',         label: 'Motivo do silêncio',      description: 'Motivo informado ao silenciar (opcional)',                       example: 'Manutenção agendada' },
    { tag: '{{customer.name}}',        label: 'Nome do cliente',         description: 'Nome do customer',                                               example: 'Mestre Álvaro' },
    { tag: '{{device.name}}',          label: 'Nome do dispositivo',     description: 'Dispositivo que gerou o alarme',                                 example: 'Sensor Temp SM-01' },
  ],
  TELEGRAM_ALARM_DIGEST: [
    { tag: '{{alarm.count}}',          label: 'Qtd. de alarmes',         description: 'Número de alarmes agrupados na janela',                          example: '5' },
    { tag: '{{alarm.type}}',           label: 'Tipo dos alarmes',        description: 'Tipo/categoria dos alarmes agrupados',                           example: 'Temperatura Elevada' },
    { tag: '{{alarm.severity}}',       label: 'Maior severidade',        description: 'Severidade mais alta entre os alarmes agrupados (opcional)',     example: 'HIGH' },
    { tag: '{{digest.windowStart}}',   label: 'Início da janela',        description: 'Data/hora de início da janela de agrupamento',                   example: '17/03/2026 10:00:00' },
    { tag: '{{digest.windowEnd}}',     label: 'Fim da janela',           description: 'Data/hora de fim da janela de agrupamento',                      example: '17/03/2026 10:05:00' },
    { tag: '{{digest.threshold}}',     label: 'Limite de agrupamento',   description: 'Qtd. mínima de alarmes para gerar o digest',                    example: '3' },
    { tag: '{{customer.name}}',        label: 'Nome do cliente',         description: 'Nome do customer',                                               example: 'Mestre Álvaro' },
  ],
  INSIGHT: [
    { tag: '{{insight.title}}',          label: 'Título do insight',               description: 'Título principal do relatório de insights',                  example: 'Resumo de Consumo — Março 2026' },
    { tag: '{{insight.period}}',         label: 'Período de análise',              description: 'Intervalo de tempo analisado',                               example: '01/03/2026 a 31/03/2026' },
    { tag: '{{insight.summary}}',        label: 'Resumo executivo',                description: 'Parágrafo com a visão geral dos insights',                   example: 'O consumo total aumentou 12% em relação ao mês anterior.' },
    { tag: '{{customer.name}}',          label: 'Nome do cliente',                 description: 'Nome do customer associado ao insight',                      example: 'Dimension Engenharia' },
    { tag: '{{#each metrics}}',          label: 'Loop — métricas',                 description: 'Repete o bloco para cada métrica do insight',                example: '' },
    { tag: '{{metric.label}}',           label: 'Label da métrica',                description: 'Dentro de {{#each metrics}}',                                example: 'Consumo Total' },
    { tag: '{{metric.value}}',           label: 'Valor da métrica',                description: 'Dentro de {{#each metrics}}',                                example: '12.450' },
    { tag: '{{metric.unit}}',            label: 'Unidade da métrica',              description: 'Dentro de {{#each metrics}}',                                example: 'kWh' },
    { tag: '{{metric.trend}}',           label: 'Tendência da métrica',            description: 'Dentro de {{#each metrics}} — UP | DOWN | STABLE',           example: 'UP' },
    { tag: '{{#each recommendations}}',  label: 'Loop — recomendações',            description: 'Repete o bloco para cada recomendação',                      example: '' },
    { tag: '{{recommendation.title}}',   label: 'Título da recomendação',          description: 'Dentro de {{#each recommendations}}',                        example: 'Reduzir consumo em horário de ponta' },
    { tag: '{{recommendation.text}}',    label: 'Texto da recomendação',           description: 'Dentro de {{#each recommendations}}',                        example: 'Considere desligar equipamentos entre 18h e 21h.' },
    { tag: '{{/each}}',                  label: 'Loop — fecha bloco',              description: 'Fecha qualquer {{#each}}',                                   example: '' },
  ],
};

// =============================================================================
// Template Renderer
// =============================================================================

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  return path.trim().split('.').reduce((acc: unknown, key) => {
    if (acc === null || acc === undefined) return '';
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

function getSingularName(collectionPath: string): string {
  const last = collectionPath.split('.').pop()!;
  return last.endsWith('s') ? last.slice(0, -1) : last;
}

/**
 * Finds the FIRST {{#each X}} block in template, correctly handling nested {{#each}}.
 * Returns split parts or null if no {{#each}} found.
 */
function findFirstEachBlock(template: string): {
  before: string;
  collectionPath: string;
  body: string;
  after: string;
} | null {
  const OPEN = '{{#each ';
  const CLOSE = '{{/each}}';

  const startIdx = template.indexOf(OPEN);
  if (startIdx === -1) return null;

  const tagClose = template.indexOf('}}', startIdx);
  if (tagClose === -1) return null;

  const collectionPath = template.slice(startIdx + OPEN.length, tagClose).trim();
  const bodyStart = tagClose + 2;

  // Walk forward tracking nesting depth to find the matching {{/each}}
  let depth = 1;
  let pos = bodyStart;

  while (depth > 0 && pos < template.length) {
    const nextOpen = template.indexOf(OPEN, pos);
    const nextClose = template.indexOf(CLOSE, pos);

    if (nextClose === -1) return null; // malformed

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen + OPEN.length;
    } else {
      depth--;
      if (depth === 0) {
        return {
          before: template.slice(0, startIdx),
          collectionPath,
          body: template.slice(bodyStart, nextClose),
          after: template.slice(nextClose + CLOSE.length),
        };
      }
      pos = nextClose + CLOSE.length;
    }
  }

  return null;
}

/**
 * Finds the FIRST {{#if path}} block in template, correctly handling nested {{#if}}.
 * Returns split parts or null if no {{#if}} found.
 */
function findFirstIfBlock(template: string): {
  before: string;
  path: string;
  body: string;
  after: string;
} | null {
  const OPEN = '{{#if ';
  const CLOSE = '{{/if}}';

  const startIdx = template.indexOf(OPEN);
  if (startIdx === -1) return null;

  const tagClose = template.indexOf('}}', startIdx);
  if (tagClose === -1) return null;

  const path = template.slice(startIdx + OPEN.length, tagClose).trim();
  const bodyStart = tagClose + 2;

  // Walk forward tracking nesting depth to find the matching {{/if}}
  let depth = 1;
  let pos = bodyStart;

  while (depth > 0 && pos < template.length) {
    const nextOpen = template.indexOf(OPEN, pos);
    const nextClose = template.indexOf(CLOSE, pos);

    if (nextClose === -1) return null; // malformed

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen + OPEN.length;
    } else {
      depth--;
      if (depth === 0) {
        return {
          before: template.slice(0, startIdx),
          path,
          body: template.slice(bodyStart, nextClose),
          after: template.slice(nextClose + CLOSE.length),
        };
      }
      pos = nextClose + CLOSE.length;
    }
  }

  return null;
}

/** Replace all {{variable}} placeholders (does NOT touch block tags like {{#each}} or {{#if}}) */
function renderVariables(template: string, ctx: Record<string, unknown>): string {
  return template.replace(/\{\{(?!#|\/)([\w.]+)\}\}/g, (_, path) => {
    const value = resolvePath(ctx, path);
    if (value === null || value === undefined) return '';
    return String(value);
  });
}

/** Returns true if a value is truthy for {{#if}} purposes */
function isTruthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === '' || value === 0) return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Recursively renders a template with data.
 * Handles {{variable}}, {{#each list}}...{{/each}}, {{#if path}}...{{/if}} (arbitrary nesting).
 * Processes blocks in document order — whichever block tag appears first is handled first.
 */
function renderBlock(template: string, ctx: Record<string, unknown>): string {
  const firstBlock = template.indexOf('{{#');
  if (firstBlock === -1) {
    return renderVariables(template, ctx);
  }

  // Determine which block type comes first
  const isEach = template.indexOf('{{#each ', firstBlock) === firstBlock;
  const isIf   = template.indexOf('{{#if ',   firstBlock) === firstBlock;

  if (isEach) {
    const block = findFirstEachBlock(template);
    if (!block) return renderVariables(template, ctx);

    const { before, collectionPath, body, after } = block;
    const items = resolvePath(ctx, collectionPath);
    const singular = getSingularName(collectionPath);

    const renderedBefore = renderBlock(before, ctx);
    const renderedItems = Array.isArray(items)
      ? items.map((item) => {
          const itemCtx = { ...ctx, [singular]: item };
          return renderBlock(body, itemCtx);
        }).join('')
      : '';
    const renderedAfter = renderBlock(after, ctx);

    return renderedBefore + renderedItems + renderedAfter;
  }

  if (isIf) {
    const block = findFirstIfBlock(template);
    if (!block) return renderVariables(template, ctx);

    const { before, path, body, after } = block;
    const value = resolvePath(ctx, path);

    const renderedBefore = renderBlock(before, ctx);
    const renderedBody   = isTruthy(value) ? renderBlock(body, ctx) : '';
    const renderedAfter  = renderBlock(after, ctx);

    return renderedBefore + renderedBody + renderedAfter;
  }

  // Unknown block tag — render variables only
  return renderVariables(template, ctx);
}

export function renderTemplate(htmlContent: string, data: Record<string, unknown>): string {
  return renderBlock(htmlContent, data);
}

// =============================================================================
// Theme Merge — inject customer colors/logo as CSS variables into HTML
// =============================================================================

function camelToKebab(str: string): string {
  return str.replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`);
}

export function buildThemeCssVars(theme: LookAndFeel): string {
  const lines: string[] = [];

  // Colors — iterate known ColorPalette fields
  const c = theme.colors;
  const colorEntries: Array<[string, string | undefined]> = [
    ['primary',          c.primary],
    ['primary-light',    c.primaryLight],
    ['primary-dark',     c.primaryDark],
    ['secondary',        c.secondary],
    ['secondary-light',  c.secondaryLight],
    ['secondary-dark',   c.secondaryDark],
    ['accent',           c.accent],
    ['background',       c.background],
    ['surface',          c.surface],
    ['surface-variant',  (c as unknown as Record<string, string>)['surfaceVariant']],
    ['error',            c.error],
    ['warning',          c.warning],
    ['success',          c.success],
    ['info',             c.info],
    ['text-primary',     c.textPrimary],
    ['text-secondary',   c.textSecondary],
    ['text-disabled',    c.textDisabled],
    ['divider',          c.divider],
  ];
  for (const [key, value] of colorEntries) {
    if (value) lines.push(`  --color-${key}: ${value};`);
  }

  // Typography
  if (theme.typography.fontFamily)          lines.push(`  --font-family: ${theme.typography.fontFamily};`);
  if (theme.typography.fontFamilySecondary) lines.push(`  --font-family-secondary: ${theme.typography.fontFamilySecondary};`);

  // Logo
  if (theme.logo.primaryUrl) lines.push(`  --logo-url: url('${theme.logo.primaryUrl}');`);
  if (theme.logo.iconUrl)    lines.push(`  --logo-icon-url: url('${theme.logo.iconUrl}');`);

  // Brand — escape non-ASCII chars as CSS Unicode escapes (e.g. á → \e1 )
  if (theme.brandName) {
    const escaped = theme.brandName.replace(
      /[^\x00-\x7F]/g,
      (ch) => `\\${ch.codePointAt(0)!.toString(16)} `,
    );
    lines.push(`  --brand-name: "${escaped}";`);
  }

  return `:root {\n${lines.join('\n')}\n}`;
}

function injectThemeIntoHtml(html: string, theme: LookAndFeel): string {
  const cssVars = buildThemeCssVars(theme);
  const styleBlock = `<style data-gcdr-theme="${theme.id}">\n${cssVars}\n</style>`;

  // Inject before </head> if present, otherwise prepend
  if (html.includes('</head>')) {
    return html.replace('</head>', `${styleBlock}\n</head>`);
  }
  return styleBlock + '\n' + html;
}

// =============================================================================
// TemplateService
// =============================================================================

export class TemplateService {
  private repository: ITemplateRepository;

  constructor(repository?: ITemplateRepository) {
    this.repository = repository ?? new TemplateRepository();
  }

  async create(tenantId: string, data: CreateTemplateDTO, userId: string): Promise<Template> {
    const existing = await this.repository.getBySlug(tenantId, data.slug);
    if (existing) {
      throw new ConflictError(`Template with slug "${data.slug}" already exists`);
    }
    return this.repository.create(tenantId, data, userId);
  }

  async getBySlug(tenantId: string, slug: string): Promise<Template> {
    const template = await this.repository.getBySlug(tenantId, slug);
    if (!template) {
      throw new NotFoundError(`Template "${slug}" not found`);
    }
    return template;
  }

  async list(tenantId: string, query: ListTemplatesQuery): Promise<TemplateSummary[]> {
    return this.repository.list(tenantId, { type: query.type, status: query.status });
  }

  async update(tenantId: string, slug: string, data: UpdateTemplateDTO): Promise<Template> {
    await this.getBySlug(tenantId, slug); // validates existence
    return this.repository.update(tenantId, slug, data);
  }

  async archive(tenantId: string, slug: string): Promise<void> {
    await this.getBySlug(tenantId, slug); // validates existence
    await this.repository.archive(tenantId, slug);
  }

  async preview(tenantId: string, slug: string, data: Record<string, unknown>, customerId?: string): Promise<string> {
    const template = await this.getBySlug(tenantId, slug);

    let html = template.htmlContent;

    if (customerId) {
      const theme =
        await lookAndFeelRepository.getByCustomerAndType(tenantId, customerId, template.type as TemplateType) ??
        await lookAndFeelRepository.getDefaultByCustomer(tenantId, customerId);
      if (theme) html = injectThemeIntoHtml(html, theme);
    }

    return renderTemplate(html, data);
  }

  getTagCatalog(type: TemplateType): TagDefinition[] {
    return TAG_CATALOG[type] ?? [];
  }

  async getActiveByType(tenantId: string, type: TemplateType): Promise<Template | null> {
    return this.repository.getActiveByType(tenantId, type);
  }

  /**
   * Builds the customer ancestor chain for hierarchy resolution.
   * Returns [customerId, parentId, grandParentId, ...] stopping before MYIO_CUSTOMER_ID.
   */
  private async getCustomerChain(tenantId: string, customerId: string): Promise<string[]> {
    const chain: string[] = [];
    let currentId: string | null = customerId;
    const MAX_DEPTH = 6;

    while (currentId && currentId !== MYIO_CUSTOMER_ID && chain.length < MAX_DEPTH) {
      chain.push(currentId);
      const customer = await customerRepo.getById(tenantId, currentId);
      currentId = customer?.parentCustomerId ?? null;
    }

    return chain;
  }

  /**
   * Render endpoint for EMAIL_SENDER.
   * Finds the template (by version or latest ACTIVE), merges customer theme as CSS vars,
   * and returns the HTML ready for tag substitution by the caller.
   *
   * Template resolution (first match wins):
   *   1. customer-specific template (customer_id = customerId, type, status=ACTIVE)
   *   2. parent customer template (walks parentCustomerId chain)
   *   3. tenant default template (customer_id IS NULL)
   *   → 404 if none found
   *
   * Theme resolution (first match wins):
   *   1. customer theme for this specific type (template_type = type, is_default)
   *   2. customer generic default theme (template_type IS NULL, is_default)
   *   3. parent customer generic default (walks parentCustomerId chain)
   *   4. MYIO platform customer default (always exists)
   */
  async renderForEmailSender(
    tenantId: string,
    type: TemplateType,
    customerId: string,
    version?: number,
  ): Promise<{
    html: string;
    template: { id: string; slug: string; type: string; version: number; status: string; customerId: string | null };
    theme: { id: string; name: string; customerId: string } | null;
    templateSource: 'customer' | 'parent_customer' | 'tenant';
    themeSource: 'customer_type' | 'customer_default' | 'parent_default' | 'tenant';
  }> {
    // 1. Find template
    let template: Template | null = null;
    let templateSource: 'customer' | 'parent_customer' | 'tenant' = 'tenant';

    if (version !== undefined) {
      template = await this.repository.getByTypeAndVersion(tenantId, type, version);
      if (!template) {
        throw new AppError(
          'TEMPLATE_VERSION_NOT_FOUND',
          `Template version ${version} not found for type ${type}`,
          404,
        );
      }
      templateSource = template.customerId ? 'customer' : 'tenant';
    } else {
      const chain = await this.getCustomerChain(tenantId, customerId);

      // Walk the chain: customer → ancestors
      for (let i = 0; i < chain.length; i++) {
        template = await this.repository.getActiveByTypeForCustomer(tenantId, chain[i], type);
        if (template) {
          templateSource = i === 0 ? 'customer' : 'parent_customer';
          break;
        }
      }

      // Fallback to tenant default
      if (!template) {
        template = await this.repository.getActiveByType(tenantId, type);
        templateSource = 'tenant';
      }

      if (!template) {
        throw new AppError(
          'TEMPLATE_NOT_FOUND',
          `No ACTIVE template found for type ${type}. Create and activate a template for this type.`,
          404,
        );
      }
    }

    // 2. Find theme — walk the customer chain
    let theme: LookAndFeel | null = null;
    let themeSource: 'customer_type' | 'customer_default' | 'parent_default' | 'tenant' = 'tenant';

    const chain = await this.getCustomerChain(tenantId, customerId);

    // 2a. Customer: theme specific to this template type
    if (chain.length > 0) {
      theme = await lookAndFeelRepository.getByCustomerAndType(tenantId, chain[0], type);
      if (theme) themeSource = 'customer_type';
    }

    // 2b. Customer: generic default theme
    if (!theme && chain.length > 0) {
      theme = await lookAndFeelRepository.getDefaultByCustomer(tenantId, chain[0]);
      if (theme) themeSource = 'customer_default';
    }

    // 2c. Parent chain: generic default
    if (!theme) {
      for (let i = 1; i < chain.length; i++) {
        theme = await lookAndFeelRepository.getDefaultByCustomer(tenantId, chain[i]);
        if (theme) {
          themeSource = 'parent_default';
          break;
        }
      }
    }

    // 2d. Tenant fallback: MYIO platform customer
    if (!theme) {
      theme = await lookAndFeelRepository.getByCustomerAndType(MYIO_TENANT_ID, MYIO_CUSTOMER_ID, type);
      if (!theme) {
        theme = await lookAndFeelRepository.getDefaultByCustomer(MYIO_TENANT_ID, MYIO_CUSTOMER_ID);
      }
      themeSource = 'tenant';
    }

    // 3. Merge theme into HTML
    const html = theme ? injectThemeIntoHtml(template.htmlContent, theme) : template.htmlContent;

    return {
      html,
      template: {
        id: template.id,
        slug: template.slug,
        type: template.type,
        version: template.version,
        status: template.status,
        customerId: template.customerId,
      },
      theme: theme ? { id: theme.id, name: theme.name, customerId: theme.customerId } : null,
      templateSource,
      themeSource,
    };
  }

  /**
   * Full render: theme injection + Handlebars data rendering in one shot.
   * Used by POST /templates/render — the EMAIL_SENDER single-call endpoint.
   */
  async renderFull(
    tenantId: string,
    type: TemplateType,
    customerId: string,
    data: Record<string, unknown>,
    version?: number,
  ): Promise<{
    html: string;
    template: { id: string; slug: string; type: string; version: number; status: string; customerId: string | null };
    theme: { id: string; name: string; customerId: string } | null;
    templateSource: 'customer' | 'parent_customer' | 'tenant';
    themeSource: 'customer_type' | 'customer_default' | 'parent_default' | 'tenant';
  }> {
    const result = await this.renderForEmailSender(tenantId, type, customerId, version);
    const html = renderTemplate(result.html, data);
    return { html, template: result.template, theme: result.theme, templateSource: result.templateSource, themeSource: result.themeSource };
  }
}

export const templateService = new TemplateService();
