import { Router } from 'express';
import {
  listFoldersHandler,
  createFolderHandler,
  updateFolderHandler,
  deleteFolderHandler,
} from '../controllers/folders.controller.js';
import { requireDb } from '../middleware/requireDb.js';

const router = Router();

router.use(requireDb);

router.get('/', listFoldersHandler);
router.post('/', createFolderHandler);
router.put('/:id', updateFolderHandler);
router.delete('/:id', deleteFolderHandler);

export default router;
