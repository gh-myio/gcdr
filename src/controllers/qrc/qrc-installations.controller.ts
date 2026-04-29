import { Router, Request, Response, NextFunction } from 'express';
import { installationService } from '../../services/qrc/InstallationService';
import { maintenanceTaskService } from '../../services/qrc/MaintenanceTaskService';
import { fileAssetService } from '../../services/FileAssetService';
import {
  InstallSchema,
  UpdateInstallationSchema,
  UpdateInstallationImageSchema,
} from '../../dto/request/qrc/InstallationDTO';
import {
  CreateMaintenanceTaskSchema,
  UpdateMaintenanceTaskSchema,
} from '../../dto/request/qrc/MaintenanceTaskDTO';
import { sendSuccess, sendCreated, sendNoContent } from '../../middleware';
import { authMiddleware } from '../../middleware/auth';
import { uploadSingleFile, multerErrorAdapter } from '../../middleware/upload';
import { ValidationError } from '../../shared/errors/AppError';
import { TcType, InstallationStatus } from '../../domain/entities/qrc/Installation';

const router = Router();

// -----------------------------------------------------------------------------
// POST /qrc/install
// Body (one of):
//   { customerId, deviceId, position, tcType?, ... }
//   { customerId, addrLow, addrHigh, position, tcType?, ... }
// -----------------------------------------------------------------------------
router.post('/install', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = InstallSchema.parse(req.body);

    const installation = await installationService.install(tenantId, {
      ...data,
      tcType: data.tcType as TcType | null | undefined,
      status: data.status as InstallationStatus | undefined,
    } as Parameters<typeof installationService.install>[1], userId);
    sendCreated(res, installation, requestId);
  } catch (err) { next(err); }
});

// -----------------------------------------------------------------------------
// GET /qrc/installations/:id
// PATCH /qrc/installations/:id
// -----------------------------------------------------------------------------
router.get('/installations/:id', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const installation = await installationService.getById(tenantId, req.params.id);
    sendSuccess(res, installation, 200, requestId);
  } catch (err) { next(err); }
});

router.patch('/installations/:id', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = UpdateInstallationSchema.parse(req.body);
    const updated = await installationService.update(tenantId, req.params.id, {
      ...data,
      tcType: data.tcType as TcType | null | undefined,
      status: data.status as InstallationStatus | undefined,
    }, userId);
    sendSuccess(res, updated, 200, requestId);
  } catch (err) { next(err); }
});

// -----------------------------------------------------------------------------
// GET /qrc/installations/:id/audit  — revision log
// -----------------------------------------------------------------------------
router.get('/installations/:id/audit', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const items = await installationService.listAudit(tenantId, req.params.id);
    sendSuccess(res, { items }, 200, requestId);
  } catch (err) { next(err); }
});

// -----------------------------------------------------------------------------
// Images: GET / POST (multipart) / PATCH / DELETE
// -----------------------------------------------------------------------------
router.get('/installations/:id/images', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const items = await installationService.listImages(tenantId, req.params.id);
    sendSuccess(res, { items }, 200, requestId);
  } catch (err) { next(err); }
});

router.post('/installations/:id/images',
  authMiddleware,
  uploadSingleFile,
  multerErrorAdapter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      if (!req.file) throw new ValidationError('Missing "file" field in multipart payload');

      // 1) Upload to FileAssets (S3)
      const { asset, downloadUrl } = await fileAssetService.upload({
        tenantId,
        userId,
        customerId: null,
        ownerType: 'qrc_installation',
        ownerId: req.params.id,
        filename: req.file.originalname,
        contentType: req.file.mimetype,
        body: req.file.buffer,
        metadata: {},
        publicSlug: null,
      });

      // 2) Create the join row + audit emission
      const caption = typeof req.body?.caption === 'string' ? req.body.caption : null;
      const imageOrderRaw = req.body?.imageOrder;
      const imageOrder = imageOrderRaw !== undefined && imageOrderRaw !== '' ? Number(imageOrderRaw) : undefined;
      const join = await installationService.attachImage(
        tenantId, req.params.id, asset.id,
        { caption, imageOrder: Number.isFinite(imageOrder) ? imageOrder : undefined },
        userId,
      );

      sendCreated(res, { ...join, fileAsset: asset, downloadUrl }, requestId);
    } catch (err) { next(err); }
  },
);

router.patch('/installations/:installationId/images/:imageId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const data = UpdateInstallationImageSchema.parse(req.body);
    const updated = await installationService.updateImage(tenantId, req.params.imageId, data);
    sendSuccess(res, updated, 200, requestId);
  } catch (err) { next(err); }
});

router.delete('/installations/:installationId/images/:imageId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId } = req.context;
    await installationService.detachImage(tenantId, req.params.imageId, userId);
    sendNoContent(res);
  } catch (err) { next(err); }
});

// -----------------------------------------------------------------------------
// Maintenance tasks: GET / POST / PATCH
// -----------------------------------------------------------------------------
router.get('/installations/:id/tasks', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const items = await maintenanceTaskService.list(tenantId, req.params.id);
    sendSuccess(res, { items }, 200, requestId);
  } catch (err) { next(err); }
});

router.post('/installations/:id/tasks', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = CreateMaintenanceTaskSchema.parse(req.body);
    const task = await maintenanceTaskService.create(tenantId, req.params.id, data.description, userId);
    sendCreated(res, task, requestId);
  } catch (err) { next(err); }
});

router.patch('/installations/:installationId/tasks/:taskId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = UpdateMaintenanceTaskSchema.parse(req.body);
    const updated = await maintenanceTaskService.update(tenantId, req.params.taskId, data, userId);
    sendSuccess(res, updated, 200, requestId);
  } catch (err) { next(err); }
});

export default router;
