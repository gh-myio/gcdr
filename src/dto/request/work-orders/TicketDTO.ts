import { z } from 'zod';
import { EXECUTION_WORK_ORDER_TYPES } from './WorkOrderDTO';

// RFC-0044 — Chamados (Work Order type CHAMADO) request DTOs.

export const TICKET_PRIORITIES = ['BAIXA', 'MEDIA', 'ALTA', 'URGENTE'] as const;
export const TICKET_SOURCES = ['PAINEL', 'EMAIL', 'FRESHDESK', 'API'] as const;
export const TICKET_VIEWS = ['TECNICO', 'SUPERVISOR', 'HOLDING', 'ALL'] as const;
export const TICKET_ACTIONS = ['pending', 'awaiting', 'resolve', 'close', 'reopen', 'cancel'] as const;

export const OpenTicketSchema = z.object({
  customerId: z.string().uuid(),
  subject: z.string().trim().min(1).max(255),
  reason: z.string().max(255).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  source: z.enum(TICKET_SOURCES).optional(),
  requesterEmail: z.string().email().max(255),
  assignedTo: z.string().uuid().nullable().optional(),
  devices: z.array(z.string().uuid()).max(500).optional(),
  rootAssetId: z.string().uuid().nullable().optional(),
  cc: z.array(z.string().email()).max(50).optional(),
  externalId: z.string().max(255).optional(),
});
export type OpenTicketDTO = z.infer<typeof OpenTicketSchema>;

export const DeriveWorkOrderSchema = z.object({
  type: z.enum(EXECUTION_WORK_ORDER_TYPES),
  assignedTo: z.string().uuid().nullable().optional(),
  devices: z.array(z.string().uuid()).max(500).optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  rootAssetId: z.string().uuid().nullable().optional(),
});
export type DeriveWorkOrderDTO = z.infer<typeof DeriveWorkOrderSchema>;

export const TicketTransitionSchema = z.object({
  action: z.enum(TICKET_ACTIONS),
  note: z.string().max(2000).optional(),
});
export type TicketTransitionDTO = z.infer<typeof TicketTransitionSchema>;

export const ListTicketsSchema = z.object({
  status: z.string().max(40).optional(),
  view: z.enum(TICKET_VIEWS).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
export type ListTicketsDTO = z.infer<typeof ListTicketsSchema>;
