import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as controller from '../controllers/workspaces.controller.js';
import { requireDb } from '../middleware/requireDb.js';

const router = Router();

// Each invitation sends an email, so they are capped per person, like account emails.
const inviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) => String(req.user._id),
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'error', message: 'Too many invitations sent. Try again later.' },
});

router.use(requireDb);

// Before /:id, so "invites" is not taken for a workspace id.
router.get('/invites', controller.myInvites);
router.post('/invites/:inviteId/accept', controller.acceptInvite);
router.post('/invites/:inviteId/decline', controller.declineInvite);

router.get('/', controller.list);
router.post('/', controller.create);
router.put('/:id', controller.rename);
router.delete('/:id', controller.remove);

router.get('/:id/members', controller.members);
router.put('/:id/members/:memberId', controller.changeRole);
router.delete('/:id/members/:memberId', controller.removeMember);
router.post('/:id/invites', inviteLimiter, controller.invite);
router.delete('/:id/invites/:inviteId', controller.revokeInvite);

export default router;
