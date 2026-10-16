import { Router } from 'express';
import {
  createMockHandler,
  listMocksHandler,
  getMockHandler,
  updateMockHandler,
  deleteMockHandler,
} from '../controllers/mocks.controller.js';
import { requireDb } from '../middleware/requireDb.js';

const router = Router();

router.use(requireDb);

router.post('/', createMockHandler);
router.get('/', listMocksHandler);
router.get('/:id', getMockHandler);
router.put('/:id', updateMockHandler);
router.delete('/:id', deleteMockHandler);

export default router;
