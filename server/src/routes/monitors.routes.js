import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  listMonitorsHandler,
  createMonitorHandler,
  updateMonitorHandler,
  deleteMonitorHandler,
  runMonitorHandler,
  testAlertHandler,
} from '../controllers/monitors.controller.js';
import { requireDb } from '../middleware/requireDb.js';

const router = Router();

router.use(requireDb);

router.get('/', listMonitorsHandler);
router.post('/', createMonitorHandler);
router.put('/:id', updateMonitorHandler);
router.delete('/:id', deleteMonitorHandler);
router.post('/:id/run', runMonitorHandler);
// A test alert sends a real email and webhook, so it is capped per person.
router.post(
  '/:id/test-alert',
  rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    keyGenerator: (req) => String(req.user._id),
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'error', message: 'Too many test alerts. Try again later.' },
  }),
  testAlertHandler,
);

export default router;
