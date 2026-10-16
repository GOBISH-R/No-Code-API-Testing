import { Router } from 'express';
import {
  introspectHandler,
  getSchemaHandler,
  deleteSchemaHandler,
} from '../controllers/graphql.controller.js';
import { requireDb } from '../middleware/requireDb.js';

const router = Router();

// No requireDb: introspection is a live fetch, and caching it is best-effort — the
// same graceful degradation /api/requests/execute already has when the database is
// unavailable. Only the cache-backed routes below genuinely need a connection.
router.post('/introspect', introspectHandler);

router.get('/schema', requireDb, getSchemaHandler);
router.delete('/schema', requireDb, deleteSchemaHandler);

export default router;
