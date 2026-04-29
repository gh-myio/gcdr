import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { qrcCustomerSettingsService } from '../../services/qrc/QrcCustomerSettingsService';
import { customerObservationService } from '../../services/qrc/CustomerObservationService';
import { qrcReportService } from '../../services/qrc/QrcReportService';
import { customerRepository } from '../../repositories/CustomerRepository';
import { deviceRepository } from '../../repositories/DeviceRepository';
import { installationRepository } from '../../repositories/qrc/InstallationRepository';
import { authService } from '../../services/AuthService';
import {
  EnableQrcCustomerSchema,
  UpdateQrcCustomerSettingsSchema,
} from '../../dto/request/qrc/CustomerSettingsDTO';
import { CreateCustomerObservationSchema } from '../../dto/request/qrc/CustomerObservationDTO';
import { sendSuccess, sendCreated, sendNoContent } from '../../middleware';
import { authMiddleware } from '../../middleware/auth';
import { NotFoundError, ValidationError, UnauthorizedError } from '../../shared/errors/AppError';
import { toCustomerResponseDTO, toCustomerResponseDTOList } from '../../dto/response/CustomerResponseDTO';

const router = Router();

// =============================================================================
// /api/v1/qrc/customers
//
// Returns ONLY QR-enabled customers (those with a row in
// qrc_customer_settings). Combines basic customer fields with the optional
// `qrc` progress block when ?include=stats is present.
// =============================================================================

router.get('/', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const includeStats = req.query.include === 'stats';

    const settings = await qrcCustomerSettingsService.listEnabled(tenantId);
    const customers = await Promise.all(
      settings.map((s) => customerRepository.getById(tenantId, s.customerId)),
    );
    const live = customers.filter((c): c is NonNullable<typeof c> => Boolean(c));

    if (!includeStats) {
      sendSuccess(res, { items: toCustomerResponseDTOList(live) }, 200, requestId);
      return;
    }

    const enriched = await Promise.all(
      live.map(async (c) => {
        const stats = await qrcReportService.customerReport(tenantId, c.id);
        return { ...toCustomerResponseDTO(c), qrc: stats };
      }),
    );
    sendSuccess(res, { items: enriched }, 200, requestId);
  } catch (err) { next(err); }
});

// -----------------------------------------------------------------------------
// GET /qrc/customers/by-code/:code  — slug → customerId resolver
// -----------------------------------------------------------------------------
router.get('/by-code/:code', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const customer = await customerRepository.getByCode(tenantId, req.params.code);
    if (!customer) throw new NotFoundError(`Customer with code ${req.params.code} not found`);

    const settings = await qrcCustomerSettingsService.getByCustomerId(tenantId, customer.id);
    if (!settings) throw new NotFoundError(`Customer ${customer.id} is not QR-enabled`);

    sendSuccess(res, toCustomerResponseDTO(customer), 200, requestId);
  } catch (err) { next(err); }
});

// -----------------------------------------------------------------------------
// POST /qrc/customers/:customerId/enable
// -----------------------------------------------------------------------------
router.post('/:customerId/enable', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = EnableQrcCustomerSchema.parse(req.body);
    const settings = await qrcCustomerSettingsService.enable(
      tenantId, req.params.customerId,
      {
        defaultCentralId: data.defaultCentralId ?? null,
        viewerPassword:   data.viewerPassword ?? null,
        qrcMetadata:      data.qrcMetadata ?? {},
      },
      userId,
    );
    sendCreated(res, settings, requestId);
  } catch (err) { next(err); }
});

// -----------------------------------------------------------------------------
// PATCH /qrc/customers/:customerId/settings
// -----------------------------------------------------------------------------
router.patch('/:customerId/settings', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const data = UpdateQrcCustomerSettingsSchema.parse(req.body);
    const updated = await qrcCustomerSettingsService.update(tenantId, req.params.customerId, data);
    sendSuccess(res, updated, 200, requestId);
  } catch (err) { next(err); }
});

// -----------------------------------------------------------------------------
// POST /qrc/customers/:customerId/disable  — drops the settings row
// -----------------------------------------------------------------------------
router.post('/:customerId/disable', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req.context;
    await qrcCustomerSettingsService.disable(tenantId, req.params.customerId);
    sendNoContent(res);
  } catch (err) { next(err); }
});

// -----------------------------------------------------------------------------
// POST /qrc/customers/:customerId/viewer-login  — viewer password gate
//
// Issues a short-lived JWT with role:qrc-viewer scoped to a single customer.
// Public — no JWT required to call this; password authenticates the viewer.
// -----------------------------------------------------------------------------
const ViewerLoginSchema = z.object({ password: z.string().min(1) });

router.post('/:customerId/viewer-login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId, ip } = req.context;
    if (!tenantId) throw new ValidationError('X-Tenant-Id header is required');

    const { password } = ViewerLoginSchema.parse(req.body);
    const ok = await qrcCustomerSettingsService.verifyViewerPassword(tenantId, req.params.customerId, password);
    if (!ok) throw new UnauthorizedError('Senha de viewer inválida');

    const customer = await customerRepository.getById(tenantId, req.params.customerId);
    if (!customer) throw new NotFoundError(`Customer ${req.params.customerId} not found`);

    const token = authService.signViewerJwt({
      tenantId,
      customerId: customer.id,
      ip: ip || 'unknown',
    });
    sendSuccess(res, {
      accessToken: token,
      tokenType: 'Bearer',
      expiresIn: 3600,
      customer: toCustomerResponseDTO(customer),
    }, 200, requestId);
  } catch (err) { next(err); }
});

// -----------------------------------------------------------------------------
// GET /qrc/customers/:customerId/devices  — devices + installation status join
// -----------------------------------------------------------------------------
router.get('/:customerId/devices', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const devices = await deviceRepository.listByCustomer(tenantId, req.params.customerId, { limit: 1000 });
    const installations = await installationRepository.listByCustomer(tenantId, req.params.customerId);
    const byDevice = new Map(installations.map((i) => [i.deviceId, i]));

    const items = devices.items.map((d) => ({
      ...d,
      qrcInstallation: byDevice.get(d.id) ?? null,
    }));
    sendSuccess(res, { items, pagination: devices.pagination }, 200, requestId);
  } catch (err) { next(err); }
});

// -----------------------------------------------------------------------------
// GET /qrc/customers/:customerId/observations
// POST /qrc/customers/:customerId/observations
// DELETE /qrc/customers/:customerId/observations/:observationId
// -----------------------------------------------------------------------------
router.get('/:customerId/observations', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const items = await customerObservationService.list(tenantId, req.params.customerId);
    sendSuccess(res, { items }, 200, requestId);
  } catch (err) { next(err); }
});

router.post('/:customerId/observations', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = CreateCustomerObservationSchema.parse(req.body);
    const created = await customerObservationService.create(
      tenantId, req.params.customerId, data.observation, data.fileAssetId ?? null, userId,
    );
    sendCreated(res, created, requestId);
  } catch (err) { next(err); }
});

router.delete('/:customerId/observations/:observationId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req.context;
    await customerObservationService.delete(tenantId, req.params.observationId);
    sendNoContent(res);
  } catch (err) { next(err); }
});

// -----------------------------------------------------------------------------
// GET /qrc/customers/:customerId/report  — JSON only in v1; xlsx/pdf TBD
// -----------------------------------------------------------------------------
router.get('/:customerId/report', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const format = (req.query.format as string | undefined) ?? 'json';
    if (format !== 'json') {
      throw new ValidationError(`Format "${format}" not implemented yet (use ?format=json)`);
    }
    const report = await qrcReportService.customerReport(tenantId, req.params.customerId);
    sendSuccess(res, report, 200, requestId);
  } catch (err) { next(err); }
});

export default router;
