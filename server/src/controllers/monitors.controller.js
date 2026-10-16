import { ownerId, actorId } from '../middleware/authenticate.js';
import * as monitorService from '../services/monitors/monitorService.js';
import { validateMonitor } from '../validators/monitorValidator.js';
import { ValidationError, TooBusyError } from '../utils/errors.js';
import { isValidId } from '../utils/objectId.js';

function fail(res, next, status, err) {
  res.status(status);
  return next(err instanceof Error ? err : new Error(err));
}

function handleError(err, res, next) {
  if (err instanceof ValidationError) return fail(res, next, 400, err);
  if (err instanceof TooBusyError) return fail(res, next, 429, err);
  return next(err);
}

function pick(body) {
  const { name, collectionId, environmentId, intervalMinutes, enabled, alertEmail, alertWebhookUrl } = body || {};
  return {
    name: typeof name === 'string' ? name.trim() : name,
    collectionId,
    environmentId,
    intervalMinutes,
    enabled,
    alertEmail,
    alertWebhookUrl: typeof alertWebhookUrl === 'string' ? alertWebhookUrl.trim() : alertWebhookUrl,
  };
}

export async function listMonitorsHandler(req, res, next) {
  try {
    res.status(200).json(await monitorService.listMonitors(ownerId(req)));
  } catch (err) {
    next(err);
  }
}

export async function createMonitorHandler(req, res, next) {
  const payload = pick(req.body);
  const errors = validateMonitor(payload);
  if (errors.length > 0) return fail(res, next, 400, errors.join(' '));
  try {
    res.status(201).json(await monitorService.createMonitor(ownerId(req), payload, actorId(req)));
  } catch (err) {
    handleError(err, res, next);
  }
}

export async function updateMonitorHandler(req, res, next) {
  if (!isValidId(req.params.id)) return fail(res, next, 400, 'Invalid monitor id.');
  const payload = pick(req.body);
  const errors = validateMonitor(payload, { partial: true });
  if (errors.length > 0) return fail(res, next, 400, errors.join(' '));
  try {
    const monitor = await monitorService.updateMonitor(ownerId(req), req.params.id, payload);
    if (!monitor) return fail(res, next, 404, 'Monitor not found.');
    res.status(200).json(monitor);
  } catch (err) {
    handleError(err, res, next);
  }
}

export async function deleteMonitorHandler(req, res, next) {
  if (!isValidId(req.params.id)) return fail(res, next, 400, 'Invalid monitor id.');
  try {
    const deleted = await monitorService.deleteMonitor(ownerId(req), req.params.id);
    if (!deleted) return fail(res, next, 404, 'Monitor not found.');
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function runMonitorHandler(req, res, next) {
  if (!isValidId(req.params.id)) return fail(res, next, 400, 'Invalid monitor id.');
  try {
    const monitor = await monitorService.runMonitorNow(ownerId(req), req.params.id);
    if (!monitor) return fail(res, next, 404, 'Monitor not found.');
    res.status(200).json(monitor);
  } catch (err) {
    handleError(err, res, next);
  }
}

export async function testAlertHandler(req, res, next) {
  if (!isValidId(req.params.id)) return fail(res, next, 400, 'Invalid monitor id.');
  try {
    const result = await monitorService.sendTestAlert(ownerId(req), req.params.id);
    if (!result) return fail(res, next, 404, 'Monitor not found.');
    res.status(200).json(result);
  } catch (err) {
    handleError(err, res, next);
  }
}
