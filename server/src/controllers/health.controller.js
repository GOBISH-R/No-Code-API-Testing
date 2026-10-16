import { getDBStatus } from '../config/db.js';

export function getHealth(req, res) {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    database: getDBStatus(),
  });
}
