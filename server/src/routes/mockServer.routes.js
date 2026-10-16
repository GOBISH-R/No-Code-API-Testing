import { Router } from 'express';
import { serveMockHandler } from '../controllers/mockServer.controller.js';
import { requireDb } from '../middleware/requireDb.js';

const router = Router();

router.use(requireDb);

/**
 * /mock/<mockKey>/anything/nested
 *
 * The leading key namespaces each account's mocks. The rest of the path is
 * reconstructed from req.params.splat in the handler.
 */
router.all('/:mockKey/{*splat}', serveMockHandler);

// The key alone, with no path after it, is still a valid request for "/".
router.all('/:mockKey', serveMockHandler);

export default router;
