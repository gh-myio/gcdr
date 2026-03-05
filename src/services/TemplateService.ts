import { Template, TemplateSummary, TemplateType } from '../domain/entities/Template';
import { CreateTemplateDTO, UpdateTemplateDTO, ListTemplatesQuery } from '../dto/request/TemplateDTO';
import { TemplateRepository } from '../repositories/TemplateRepository';
import { ITemplateRepository } from '../repositories/interfaces/ITemplateRepository';
import { ConflictError, NotFoundError } from '../shared/errors/AppError';

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

/** Replace all {{variable}} placeholders (does NOT touch {{#each}} or {{/each}}) */
function renderVariables(template: string, ctx: Record<string, unknown>): string {
  return template.replace(/\{\{(?!#|\/)([\w.]+)\}\}/g, (_, path) => {
    const value = resolvePath(ctx, path);
    if (value === null || value === undefined) return '';
    return String(value);
  });
}

/**
 * Recursively renders a template with data.
 * Handles {{variable}}, {{#each list}}...{{/each}} (arbitrary nesting).
 */
function renderBlock(template: string, ctx: Record<string, unknown>): string {
  const eachBlock = findFirstEachBlock(template);

  if (!eachBlock) {
    return renderVariables(template, ctx);
  }

  const { before, collectionPath, body, after } = eachBlock;

  const items = resolvePath(ctx, collectionPath);
  const singular = getSingularName(collectionPath);

  const renderedBefore = renderVariables(before, ctx);

  const renderedItems = Array.isArray(items)
    ? items.map((item) => {
        const itemCtx = { ...ctx, [singular]: item };
        return renderBlock(body, itemCtx);
      }).join('')
    : '';

  const renderedAfter = renderBlock(after, ctx);

  return renderedBefore + renderedItems + renderedAfter;
}

export function renderTemplate(htmlContent: string, data: Record<string, unknown>): string {
  return renderBlock(htmlContent, data);
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

  async preview(tenantId: string, slug: string, data: Record<string, unknown>): Promise<string> {
    const template = await this.getBySlug(tenantId, slug);
    return renderTemplate(template.htmlContent, data);
  }

  getTagCatalog(type: TemplateType): TagDefinition[] {
    return TAG_CATALOG[type] ?? [];
  }

  async getActiveByType(tenantId: string, type: TemplateType): Promise<Template | null> {
    return this.repository.getActiveByType(tenantId, type);
  }
}

export const templateService = new TemplateService();
