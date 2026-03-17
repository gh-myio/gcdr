import { Router, Request, Response, NextFunction } from 'express';
import { groupService } from '../services/GroupService';
import { UserRepository } from '../repositories/UserRepository';
import {
  CreateGroupSchema,
  UpdateGroupSchema,
  AddMembersSchema,
  RemoveMembersSchema,
  ListGroupsQuerySchema,
} from '../dto/request/GroupDTO';
import { sendSuccess, sendCreated, sendNoContent, logEvent } from '../middleware';
import { ValidationError } from '../shared/errors/AppError';
import { EventType } from '../shared/types';

const router = Router();

/**
 * POST /groups
 * Create a new group
 */
router.post('/',
  logEvent({
    eventType: EventType.GROUP_CREATED,
    description: (req) => `Group "${req.body.name}" created`,
    getEntityId: (req, res) => res.locals.responseBody?.data?.id,
    getCustomerId: (req) => req.body.customerId,
    getMetadata: (req) => ({ groupType: req.body.groupType }),
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      const { customerId } = req.body;

      if (!customerId) {
        throw new ValidationError('customerId is required');
      }

      const data = CreateGroupSchema.parse(req.body);
      const group = await groupService.createGroup(tenantId, customerId, data, userId);
      sendCreated(res, group, requestId);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /groups
 * List groups with filters
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const params = ListGroupsQuerySchema.parse(req.query);
    const result = await groupService.listGroups(tenantId, params);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /groups/purposes
 * Catalog of valid group purposes with label and description
 */
router.get('/purposes', (_req: Request, res: Response) => {
  sendSuccess(res, {
    items: [
      { value: 'ALARMS_NOTIFY',  label: 'Alarmes - Notificação',          description: 'Recebe notificações em tempo real quando alarmes abrem ou fecham' },
      { value: 'ALARMS_REPORT',  label: 'Alarmes - Relatório',            description: 'Recebe relatórios periódicos consolidados de alarmes' },
      { value: 'ALARMS_INSIGHT', label: 'Alarmes - Insights',             description: 'Recebe métricas e análises sobre padrões de alarmes' },
      { value: 'WELCOME_USER',   label: 'Boas-vindas / Reset de Senha',   description: 'Recebe e-mails de boas-vindas e recuperação de acesso' },
      { value: 'RELEASE_NOTE',   label: 'Comunicado de Nova Feature',     description: 'Recebe comunicados sobre novas funcionalidades do sistema' },
      { value: 'NOTIFICATION',   label: 'Notificação',                    description: 'Grupo genérico para envio de notificações operacionais' },
      { value: 'ESCALATION',     label: 'Escalonamento',                  description: 'Cadeia de escalonamento para alarmes não reconhecidos' },
      { value: 'ACCESS_CONTROL', label: 'Controle de Acesso',             description: 'Gerenciamento de permissões e acessos' },
      { value: 'REPORTING',      label: 'Relatórios',                     description: 'Agrupamento para geração de relatórios' },
      { value: 'MAINTENANCE',    label: 'Manutenção',                     description: 'Equipes e responsáveis por manutenção programada' },
      { value: 'MONITORING',     label: 'Monitoramento',                  description: 'Painéis e dashboards de monitoramento' },
      { value: 'CUSTOM',         label: 'Personalizado',                  description: 'Finalidade livre definida pelo cliente' },
    ],
    count: 12,
  }, 200, _req.context?.requestId);
});

/**
 * GET /groups/channels
 * Catalog of valid notification channel types with label and description
 */
router.get('/channels', (_req: Request, res: Response) => {
  sendSuccess(res, {
    items: [
      { value: 'EMAIL',       label: 'E-mail',            description: 'Envio via SMTP configurado no cliente' },
      { value: 'EMAIL_RELAY', label: 'E-mail Relay',      description: 'Envio via servidor relay compartilhado da plataforma' },
      { value: 'TELEGRAM', label: 'Telegram',          description: 'Mensagem para grupo ou usuário via bot Telegram' },
      { value: 'WHATSAPP', label: 'WhatsApp',          description: 'Mensagem via API WhatsApp Business' },
      { value: 'SMS',      label: 'SMS',               description: 'Mensagem de texto para número de telefone' },
      { value: 'SLACK',    label: 'Slack',             description: 'Mensagem para canal ou usuário via webhook Slack' },
      { value: 'TEAMS',    label: 'Microsoft Teams',   description: 'Mensagem para canal via webhook Teams' },
      { value: 'WEBHOOK',  label: 'Webhook',           description: 'HTTP POST para URL configurada pelo cliente' },
      { value: 'CUSTOM',   label: 'Personalizado',     description: 'Canal customizado definido pelo cliente' },
    ],
    count: 9,
  }, 200, _req.context?.requestId);
});

/**
 * GET /groups/:id
 * Get group by ID
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Group ID is required');
    }

    const group = await groupService.getGroup(tenantId, id);
    sendSuccess(res, group, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /groups/:id
 * Update group
 */
router.put('/:id',
  logEvent({
    eventType: EventType.GROUP_UPDATED,
    description: (req) => `Group ${req.params.id} updated`,
    getEntityId: (req) => req.params.id,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      const { id } = req.params;

      if (!id) {
        throw new ValidationError('Group ID is required');
      }

      const data = UpdateGroupSchema.parse(req.body);
      const group = await groupService.updateGroup(tenantId, id, data, userId);
      sendSuccess(res, group, 200, requestId);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /groups/:id
 * Delete group
 */
router.delete('/:id',
  logEvent({
    eventType: EventType.GROUP_DELETED,
    description: (req) => `Group ${req.params.id} deleted`,
    getEntityId: (req) => req.params.id,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId } = req.context;
      const { id } = req.params;
      const { soft } = req.query;

      if (!id) {
        throw new ValidationError('Group ID is required');
      }

      if (soft === 'true') {
        await groupService.softDeleteGroup(tenantId, id, userId);
      } else {
        await groupService.deleteGroup(tenantId, id);
      }

      sendNoContent(res);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /groups/:id/members
 * List members of a group, enriched with user data (name, email) from DB.
 * Only the member id is trusted from the group JSONB — name/email come from users table.
 */
router.get('/:id/members', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Group ID is required');
    }

    const group = await groupService.getGroup(tenantId, id);

    // Enrich USER members with data from the users table
    const userMemberIds = group.members
      .filter(m => m.type === 'USER')
      .map(m => m.id);

    const userRepo = new UserRepository();
    const userDetails = await userRepo.getByIds(tenantId, userMemberIds);
    const userMap = new Map(userDetails.map(u => [u.id, u]));

    const items = group.members.map(m => {
      if (m.type !== 'USER') return { id: m.id, type: m.type, addedAt: m.addedAt };
      const u = userMap.get(m.id);
      return {
        id: m.id,
        type: m.type,
        addedAt: m.addedAt,
        name: u?.profile?.displayName ?? `${u?.profile?.firstName ?? ''} ${u?.profile?.lastName ?? ''}`.trim() ?? null,
        email: u?.email ?? null,
      };
    });

    sendSuccess(res, { items, count: items.length }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /groups/:id/members
 * Add members to group
 */
router.post('/:id/members',
  logEvent({
    eventType: EventType.GROUP_MEMBER_ADDED,
    description: (req) => `Members added to group ${req.params.id}`,
    getEntityId: (req) => req.params.id,
    getMetadata: (req) => ({ memberCount: req.body.members?.length }),
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      const { id } = req.params;

      if (!id) {
        throw new ValidationError('Group ID is required');
      }

      const data = AddMembersSchema.parse(req.body);
      const group = await groupService.addMembers(tenantId, id, data, userId);
      sendSuccess(res, group, 200, requestId);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /groups/:id/members
 * Remove members from group
 */
router.delete('/:id/members',
  logEvent({
    eventType: EventType.GROUP_MEMBER_REMOVED,
    description: (req) => `Members removed from group ${req.params.id}`,
    getEntityId: (req) => req.params.id,
    getMetadata: (req) => ({ memberCount: req.body.memberIds?.length }),
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      const { id } = req.params;

      if (!id) {
        throw new ValidationError('Group ID is required');
      }

      const data = RemoveMembersSchema.parse(req.body);
      const group = await groupService.removeMembers(tenantId, id, data.memberIds, userId);
      sendSuccess(res, group, 200, requestId);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /groups/:id/children
 * Get child groups
 */
router.get('/:id/children', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Group ID is required');
    }

    const children = await groupService.getChildGroups(tenantId, id);
    sendSuccess(res, children, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /groups/:id/descendants
 * Get all descendant groups
 */
router.get('/:id/descendants', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Group ID is required');
    }

    const descendants = await groupService.getDescendantGroups(tenantId, id);
    sendSuccess(res, descendants, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /groups/:id/move
 * Move group to new parent
 */
router.post('/:id/move', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { id } = req.params;
    const { newParentGroupId } = req.body;

    if (!id) {
      throw new ValidationError('Group ID is required');
    }

    const group = await groupService.moveGroup(tenantId, id, newParentGroupId || null, userId);
    sendSuccess(res, group, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /groups/by-member/:memberId
 * Get groups by member
 */
router.get('/by-member/:memberId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { memberId } = req.params;
    const { memberType } = req.query;

    if (!memberId) {
      throw new ValidationError('Member ID is required');
    }

    if (!memberType || !['USER', 'DEVICE', 'ASSET'].includes(memberType as string)) {
      throw new ValidationError('memberType query param is required (USER, DEVICE, or ASSET)');
    }

    const groups = await groupService.getGroupsByMember(
      tenantId,
      memberId,
      memberType as 'USER' | 'DEVICE' | 'ASSET'
    );
    sendSuccess(res, groups, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
