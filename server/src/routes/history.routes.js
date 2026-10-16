import { Router } from 'express';
import {
  listHistoryHandler,
  getHistoryEntryHandler,
  deleteHistoryEntryHandler,
  clearHistoryHandler,
} from '../controllers/history.controller.js';
import { requireDb } from '../middleware/requireDb.js';

const router = Router();

router.use(requireDb);

router.get('/', listHistoryHandler);
router.delete('/', clearHistoryHandler);
router.get('/:id', getHistoryEntryHandler);
router.delete('/:id', deleteHistoryEntryHandler);

export default router;
