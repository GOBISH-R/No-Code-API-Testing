import { Router } from 'express';
import { listTestRunsHandler, getTestRunHandler } from '../controllers/testRuns.controller.js';
import { requireDb } from '../middleware/requireDb.js';

const router = Router();

router.use(requireDb);

router.get('/', listTestRunsHandler);
router.get('/:id', getTestRunHandler);

export default router;
