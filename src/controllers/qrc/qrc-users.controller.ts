import { Router, Request, Response, NextFunction } from 'express';
import { userRepository } from '../../repositories/UserRepository';
import { installationAuditRepository } from '../../repositories/qrc/InstallationAuditRepository';
import { pinColumnsForWrite } from '../../services/qrc/QrcPinService';
import { SetOperatorPinSchema } from '../../dto/request/auth/OperatorPinSchema';
import { sendSuccess, sendNoContent } from '../../middleware';
import { authMiddleware } from '../../middleware/auth';
import { ConflictError, NotFoundError } from '../../shared/errors/AppError';

const router = Router();
router.use(authMiddleware);

// -----------------------------------------------------------------------------
// PATCH /qrc/users/:userId/pin
// Body: { pin: "1234" } → set/replace
//       { pin: null }    → clear
// -----------------------------------------------------------------------------
router.patch('/:userId/pin', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req.context;
    const userId = req.params.userId;

    const user = await userRepository.getById(tenantId, userId);
    if (!user) throw new NotFoundError(`User ${userId} not found`);

    const { pin } = SetOperatorPinSchema.parse(req.body);

    if (pin === null) {
      await userRepository.updateQrcPin(tenantId, userId, null);
      sendNoContent(res);
      return;
    }

    const cols = await pinColumnsForWrite(tenantId, pin);

    // Defend against PIN collision — partial UNIQUE index on
    // (tenant_id, qrc_field_pin_lookup) will throw 23505 if collision;
    // map it to 409 PIN_TAKEN for clearer FE handling.
    try {
      await userRepository.updateQrcPin(tenantId, userId, cols);
    } catch (err) {
      if ((err as { code?: string })?.code === '23505') {
        throw new ConflictError('PIN already in use by another user in this tenant');
      }
      throw err;
    }
    sendNoContent(res);
  } catch (err) { next(err); }
});

// -----------------------------------------------------------------------------
// GET /qrc/users/:userId/audit  — drives admin user-history screen
// -----------------------------------------------------------------------------
router.get('/:userId/audit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const result = await installationAuditRepository.listByUser(tenantId, req.params.userId, { limit, offset });
    sendSuccess(res, result, 200, requestId);
  } catch (err) { next(err); }
});

export default router;
