import { Router } from 'express';
import {
  executeRequestHandler,
  createSavedRequestHandler,
  getSavedRequestHandler,
  updateSavedRequestHandler,
  deleteSavedRequestHandler,
} from '../controllers/requests.controller.js';
import { requireDb } from '../middleware/requireDb.js';
import { executeLimiter } from '../middleware/rateLimits.js';

const router = Router();

router.post('/execute', executeLimiter, executeRequestHandler);

router.post('/', requireDb, createSavedRequestHandler);
router.get('/:id', requireDb, getSavedRequestHandler);
router.put('/:id', requireDb, updateSavedRequestHandler);
router.delete('/:id', requireDb, deleteSavedRequestHandler);

export default router;
