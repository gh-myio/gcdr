import { Router } from 'express';
import metaRouter from './inventory/meta.controller';
import catalogRouter from './inventory/catalog.controller';
import stockRouter from './inventory/stock.controller';
import purchasesRouter from './inventory/purchases.controller';
import productionRouter from './inventory/production.controller';
import homologationRouter from './inventory/homologation.controller';
import expeditionRouter from './inventory/expedition.controller';
import fieldRouter from './inventory/field.controller';
import externalRouter from './inventory/external.controller';
import projectsRouter from './inventory/projects.controller';

// =============================================================================
// RFC-0061 — Inventory controller (per-module composition).
//
// Auth is mounted in app.ts (hybridAuthByMethod inventory:read/inventory:write).
// Each module owns src/controllers/inventory/<module>.controller.ts so module
// implementations land as independent PRs without touching each other; this
// index only composes them. Cross-cutting guards live in ./inventory/shared.ts.
// A module not yet shipped answers 501 INV_NOT_IMPLEMENTED { module, phase }
// after validating the request (contract-first — see the RFC's Delivery phases).
// =============================================================================

const router = Router();

router.use(metaRouter);
router.use(catalogRouter); // M1 (P0)
router.use(stockRouter); // M2 (P0)
router.use(purchasesRouter); // M3 (P1)
router.use(productionRouter); // M4 (P2/P3)
router.use(homologationRouter); // M5 (P2)
router.use(expeditionRouter); // M6 (P3)
router.use(fieldRouter); // M7 (P3)
router.use(externalRouter); // M8 (P2/P4)
router.use(projectsRouter); // M9 (P1)

export default router;
