const UNITS = [
  { ms: 24 * 60 * 60 * 1000, label: 'd' },
  { ms: 60 * 60 * 1000, label: 'h' },
  { ms: 60 * 1000, label: 'min' },
];

/** "just now", "in 4 min", "2 h ago", "3 d ago" — short enough for a list row. */
export function fromNow(date, now = Date.now()) {
  const diff = new Date(date).getTime() - now;
  const abs = Math.abs(diff);
  if (abs < 60 * 1000) return diff > 0 ? 'in under a minute' : 'just now';
  const unit = UNITS.find((u) => abs >= u.ms);
  const value = Math.round(abs / unit.ms);
  return diff > 0 ? `in ${value} ${unit.label}` : `${value} ${unit.label} ago`;
}

const INTERVAL_LABELS = {
  5: 'Every 5 minutes',
  15: 'Every 15 minutes',
  30: 'Every 30 minutes',
  60: 'Every hour',
  360: 'Every 6 hours',
  720: 'Every 12 hours',
  1440: 'Every day',
};

/** The schedules the server accepts, in order, with their labels. */
export const MONITOR_INTERVALS = Object.entries(INTERVAL_LABELS).map(([minutes, label]) => ({
  minutes: Number(minutes),
  label,
}));

export function intervalLabel(minutes) {
  return INTERVAL_LABELS[minutes] || `Every ${minutes} minutes`;
}
