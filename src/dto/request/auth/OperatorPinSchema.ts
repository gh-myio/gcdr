import { z } from 'zod';

// =============================================================================
// RFC-0032 Phase 2 — operator-pin login DTO
//
// POST /api/v1/auth/operator-pin
// Body: { pin: 4-digit string, tenantId: uuid }
// =============================================================================

export const OperatorPinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
  tenantId: z.string().uuid('tenantId must be a valid UUID'),
});

export type OperatorPinDTO = z.infer<typeof OperatorPinSchema>;

// Admin endpoint: set / change / clear a field operator's PIN.
// PATCH /api/v1/qrc/users/:userId/pin
//
// Body: { pin: 4-digit string }    → set or replace
//       { pin: null }               → clear
export const SetOperatorPinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits').nullable(),
});

export type SetOperatorPinDTO = z.infer<typeof SetOperatorPinSchema>;
