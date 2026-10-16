import { Router } from 'express';
import {
  createCollectionHandler,
  listCollectionsHandler,
  getCollectionHandler,
  updateCollectionHandler,
  deleteCollectionHandler,
} from '../controllers/collections.controller.js';
import { runCollectionHandler } from '../controllers/runner.controller.js';
import {
  exportCollectionHandler,
  importCollectionHandler,
  importOpenApiHandler,
  transferCollectionHandler,
} from '../controllers/importExport.controller.js';
import { requireDb } from '../middleware/requireDb.js';

const router = Router();

router.use(requireDb);

router.post('/', createCollectionHandler);
router.get('/', listCollectionsHandler);
// Declared before the /:id routes so "import"/"import-openapi" are never read as an id.
router.post('/import', importCollectionHandler);
router.post('/import-openapi', importOpenApiHandler);
router.get('/:id', getCollectionHandler);
router.put('/:id', updateCollectionHandler);
router.delete('/:id', deleteCollectionHandler);
router.post('/:id/run', runCollectionHandler);
router.get('/:id/export', exportCollectionHandler);
router.post('/:id/copy', transferCollectionHandler);

export default router;
