import { Router } from 'express';
import { getGlobalsHandler, updateGlobalsHandler } from '../controllers/globals.controller.js';
import { requireDb } from '../middleware/requireDb.js';

const router = Router();

router.use(requireDb);

router.get('/', getGlobalsHandler);
router.put('/', updateGlobalsHandler);

export default router;
