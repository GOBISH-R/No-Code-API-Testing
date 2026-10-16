import { Router } from 'express';
import {
  createEnvironmentHandler,
  listEnvironmentsHandler,
  getEnvironmentHandler,
  updateEnvironmentHandler,
  deleteEnvironmentHandler,
} from '../controllers/environments.controller.js';
import { requireDb } from '../middleware/requireDb.js';

const router = Router();

router.use(requireDb);

router.post('/', createEnvironmentHandler);
router.get('/', listEnvironmentsHandler);
router.get('/:id', getEnvironmentHandler);
router.put('/:id', updateEnvironmentHandler);
router.delete('/:id', deleteEnvironmentHandler);

export default router;
