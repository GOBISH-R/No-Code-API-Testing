import mongoose from 'mongoose';
import { actorId } from '../middleware/authenticate.js';
import * as historyService from '../services/history/historyService.js';
import { isValidId } from '../utils/objectId.js';

/**
 * Records a send without ever failing it.
 *
 * History is a convenience; the response the user is waiting for is not. With no
 * database, or on any write error, the send still succeeds and the entry is skipped.
 * Logs the reason only — never the request, whose headers and auth are credentials.
 */
export async function recordSend(req, outcome) {
  if (mongoose.connection.readyState !== 1) return;
  try {
    await historyService.recordHistory(actorId(req), req.body, outcome);
  } catch (err) {
    console.warn(`[history] Could not record a request: ${err.message}`);
  }
}

export async function listHistoryHandler(req, res, next) {
  try {
    res.status(200).json(await historyService.listHistory(actorId(req)));
  } catch (err) {
    next(err);
  }
}

export async function getHistoryEntryHandler(req, res, next) {
  if (!isValidId(req.params.id)) {
    res.status(400);
    return next(new Error('Invalid history entry id.'));
  }
  try {
    const entry = await historyService.getHistoryEntry(actorId(req), req.params.id);
    if (!entry) {
      res.status(404);
      return next(new Error('History entry not found.'));
    }
    res.status(200).json(entry);
  } catch (err) {
    next(err);
  }
}

export async function deleteHistoryEntryHandler(req, res, next) {
  if (!isValidId(req.params.id)) {
    res.status(400);
    return next(new Error('Invalid history entry id.'));
  }
  try {
    const deleted = await historyService.deleteHistoryEntry(actorId(req), req.params.id);
    if (!deleted) {
      res.status(404);
      return next(new Error('History entry not found.'));
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function clearHistoryHandler(req, res, next) {
  try {
    await historyService.clearHistory(actorId(req));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
