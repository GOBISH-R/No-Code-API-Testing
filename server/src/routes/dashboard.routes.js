import { Router } from 'express';
import { getDashboardHandler } from '../controllers/dashboard.controller.js';
import { requireDb } from '../middleware/requireDb.js';

const router = Router();

router.use(requireDb);

router.get('/', getDashboardHandler);

export default router;
