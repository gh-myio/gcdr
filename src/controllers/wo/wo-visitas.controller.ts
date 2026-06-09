import { Router, Request, Response, NextFunction } from 'express';
import { visitaService } from '../../services/wo/VisitaService';
import { woReportService } from '../../services/wo/WoReportService';
import { fileAssetService } from '../../services/FileAssetService';
import {
  CreateVisitaSchema,
  UpdateVisitaSchema,
  CreateVisitaAmbienteSchema,
  UpdateVisitaAmbienteSchema,
  UpdateVisitaAmbienteImageSchema,
  CreateVisitaProductSchema,
  UpdateVisitaProductSchema,
  CreateVisitaObservationSchema,
} from '../../dto/request/wo/VisitaDTO';
import { sendSuccess, sendCreated, sendNoContent } from '../../middleware';
import { authMiddleware } from '../../middleware/auth';
import { uploadSingleFile, multerErrorAdapter } from '../../middleware/upload';
import { ValidationError } from '../../shared/errors/AppError';
import { VisitaStatus } from '../../domain/entities/wo/Visita';

const router = Router();
router.use(authMiddleware);

// =============================================================================
// /api/v1/wo/visitas
// =============================================================================

// LIST
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const customerId = (req.query.customerId as string) || undefined;
    const status = (req.query.status as VisitaStatus) || undefined;

    const result = await visitaService.list(tenantId, { customerId, status, limit, offset });
    sendSuccess(res, result, 200, requestId);
  } catch (err) { next(err); }
});

// CREATE
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = CreateVisitaSchema.parse(req.body);
    const v = await visitaService.create(tenantId, {
      customerId:  data.customerId ?? null,
      name:        data.name,
      observation: data.observation ?? null,
    }, userId);
    sendCreated(res, v, requestId);
  } catch (err) { next(err); }
});

// GET / PATCH / DELETE
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const v = await visitaService.getById(tenantId, req.params.id);
    sendSuccess(res, v, 200, requestId);
  } catch (err) { next(err); }
});

router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = UpdateVisitaSchema.parse(req.body);
    const v = await visitaService.update(tenantId, req.params.id, data, userId);
    sendSuccess(res, v, 200, requestId);
  } catch (err) { next(err); }
});

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId } = req.context;
    await visitaService.softDelete(tenantId, req.params.id, userId);
    sendNoContent(res);
  } catch (err) { next(err); }
});

// AUDIT
router.get('/:id/audit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const items = await visitaService.listAudit(tenantId, req.params.id);
    sendSuccess(res, { items }, 200, requestId);
  } catch (err) { next(err); }
});

// REPORT
router.get('/:id/report', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const r = await woReportService.visitaReport(tenantId, req.params.id);
    sendSuccess(res, r, 200, requestId);
  } catch (err) { next(err); }
});

// =============================================================================
// /api/v1/wo/visitas/:id/observations
// =============================================================================
router.get('/:id/observations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const items = await visitaService.listObservations(tenantId, req.params.id);
    sendSuccess(res, { items }, 200, requestId);
  } catch (err) { next(err); }
});

router.post('/:id/observations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = CreateVisitaObservationSchema.parse(req.body);
    const o = await visitaService.createObservation(
      tenantId, req.params.id, data.observation, data.fileAssetId ?? null, userId,
    );
    sendCreated(res, o, requestId);
  } catch (err) { next(err); }
});

router.delete('/:id/observations/:observationId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req.context;
    await visitaService.deleteObservation(tenantId, req.params.observationId);
    sendNoContent(res);
  } catch (err) { next(err); }
});

// =============================================================================
// /api/v1/wo/visitas/:id/ambientes
// =============================================================================
router.get('/:id/ambientes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const items = await visitaService.listAmbientes(tenantId, req.params.id);
    sendSuccess(res, { items }, 200, requestId);
  } catch (err) { next(err); }
});

router.post('/:id/ambientes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = CreateVisitaAmbienteSchema.parse(req.body);
    const a = await visitaService.createAmbiente(tenantId, req.params.id, {
      name:            data.name,
      observation:     data.observation ?? null,
      acQuantity:      data.acQuantity ?? null,
      productQuantity: data.productQuantity ?? null,
      productType:     data.productType ?? null,
    }, userId);
    sendCreated(res, a, requestId);
  } catch (err) { next(err); }
});

router.get('/:id/ambientes/:ambienteId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const a = await visitaService.getAmbiente(tenantId, req.params.ambienteId);
    sendSuccess(res, a, 200, requestId);
  } catch (err) { next(err); }
});

router.patch('/:id/ambientes/:ambienteId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = UpdateVisitaAmbienteSchema.parse(req.body);
    const a = await visitaService.updateAmbiente(tenantId, req.params.ambienteId, data, userId);
    sendSuccess(res, a, 200, requestId);
  } catch (err) { next(err); }
});

router.delete('/:id/ambientes/:ambienteId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId } = req.context;
    await visitaService.deleteAmbiente(tenantId, req.params.ambienteId, userId);
    sendNoContent(res);
  } catch (err) { next(err); }
});

// =============================================================================
// /api/v1/wo/visitas/:id/ambientes/:ambienteId/images
// =============================================================================
router.get('/:id/ambientes/:ambienteId/images', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const items = await visitaService.listAmbienteImages(tenantId, req.params.ambienteId);
    sendSuccess(res, { items }, 200, requestId);
  } catch (err) { next(err); }
});

router.post('/:id/ambientes/:ambienteId/images',
  uploadSingleFile,
  multerErrorAdapter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      if (!req.file) throw new ValidationError('Missing "file" field in multipart payload');

      const { asset, downloadUrl } = await fileAssetService.upload({
        tenantId,
        userId,
        customerId: null,
        ownerType: 'wo_visita_ambiente',
        ownerId: req.params.ambienteId,
        filename: req.file.originalname,
        contentType: req.file.mimetype,
        body: req.file.buffer,
        metadata: {},
        publicSlug: null,
      });

      const caption = typeof req.body?.caption === 'string' ? req.body.caption : null;
      const imageOrderRaw = req.body?.imageOrder;
      const imageOrder = imageOrderRaw !== undefined && imageOrderRaw !== '' ? Number(imageOrderRaw) : undefined;
      const join = await visitaService.attachAmbienteImage(
        tenantId, req.params.ambienteId, asset.id,
        { caption, imageOrder: Number.isFinite(imageOrder) ? imageOrder : undefined },
        userId,
      );

      sendCreated(res, { ...join, fileAsset: asset, downloadUrl }, requestId);
    } catch (err) { next(err); }
  },
);

router.patch('/:id/ambientes/:ambienteId/images/:imageId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const data = UpdateVisitaAmbienteImageSchema.parse(req.body);
    const updated = await visitaService.updateAmbienteImage(tenantId, req.params.imageId, data);
    sendSuccess(res, updated, 200, requestId);
  } catch (err) { next(err); }
});

router.delete('/:id/ambientes/:ambienteId/images/:imageId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req.context;
    await visitaService.deleteAmbienteImage(tenantId, req.params.imageId);
    sendNoContent(res);
  } catch (err) { next(err); }
});

// =============================================================================
// /api/v1/wo/visitas/:id/ambientes/:ambienteId/products
// =============================================================================
router.get('/:id/ambientes/:ambienteId/products', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const items = await visitaService.listProducts(tenantId, req.params.ambienteId);
    sendSuccess(res, { items }, 200, requestId);
  } catch (err) { next(err); }
});

router.post('/:id/ambientes/:ambienteId/products', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = CreateVisitaProductSchema.parse(req.body);
    const p = await visitaService.createProduct(tenantId, req.params.ambienteId, {
      productType: data.productType,
      description: data.description ?? null,
      quantity:    data.quantity,
    }, userId);
    sendCreated(res, p, requestId);
  } catch (err) { next(err); }
});

router.patch('/:id/ambientes/:ambienteId/products/:productId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const data = UpdateVisitaProductSchema.parse(req.body);
    const p = await visitaService.updateProduct(tenantId, req.params.productId, data);
    sendSuccess(res, p, 200, requestId);
  } catch (err) { next(err); }
});

router.delete('/:id/ambientes/:ambienteId/products/:productId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req.context;
    await visitaService.deleteProduct(tenantId, req.params.productId);
    sendNoContent(res);
  } catch (err) { next(err); }
});

// =============================================================================
// /api/v1/wo/visitas/:id/ambientes/:ambienteId/products/:productId/images
// =============================================================================
router.get('/:id/ambientes/:ambienteId/products/:productId/images', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const items = await visitaService.listProductImages(tenantId, req.params.productId);
    sendSuccess(res, { items }, 200, requestId);
  } catch (err) { next(err); }
});

router.post('/:id/ambientes/:ambienteId/products/:productId/images',
  uploadSingleFile,
  multerErrorAdapter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      if (!req.file) throw new ValidationError('Missing "file" field in multipart payload');

      const { asset, downloadUrl } = await fileAssetService.upload({
        tenantId,
        userId,
        customerId: null,
        ownerType: 'wo_visita_product',
        ownerId: req.params.productId,
        filename: req.file.originalname,
        contentType: req.file.mimetype,
        body: req.file.buffer,
        metadata: {},
        publicSlug: null,
      });

      const join = await visitaService.attachProductImage(tenantId, req.params.productId, asset.id);
      sendCreated(res, { ...join, fileAsset: asset, downloadUrl }, requestId);
    } catch (err) { next(err); }
  },
);

router.delete('/:id/ambientes/:ambienteId/products/:productId/images/:imageId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req.context;
    await visitaService.deleteProductImage(tenantId, req.params.imageId);
    sendNoContent(res);
  } catch (err) { next(err); }
});

export default router;
