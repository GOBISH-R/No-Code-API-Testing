import mongoose from 'mongoose';

const { Schema } = mongoose;

/** The schedules a monitor can run on, in minutes. Nothing more often than every 5. */
export const MONITOR_INTERVALS = [5, 15, 30, 60, 360, 720, 1440];

/**
 * A collection run on a timer — Postman's Monitors.
 *
 * Each run is an ordinary TestRun (trigger: 'monitor'), so Runs, the Dashboard and the
 * Report show it with no special handling. This document only holds the schedule and a
 * summary of the latest outcome, so the monitors list never has to read run documents.
 */
const monitorSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    collectionId: { type: Schema.Types.ObjectId, ref: 'Collection', required: true },
    environmentId: { type: Schema.Types.ObjectId, ref: 'Environment', default: null },
    intervalMinutes: { type: Number, enum: MONITOR_INTERVALS, required: true },
    enabled: { type: Boolean, default: true },

    // When the scheduler should next pick it up. Advanced at the moment a run is
    // claimed, not when it finishes, so a slow run cannot be claimed twice.
    nextRunAt: { type: Date, required: true },
    // Held while a run is in progress. Expires on its own, so a server that dies mid-run
    // does not leave the monitor stuck forever.
    lockedUntil: { type: Date, default: null },

    // Who made it: the person alert emails go to. Absent on monitors made before alerts
    // existed, which then alert the owner of the space they live in.
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    alertEmail: { type: Boolean, default: true },
    // Slack, Discord, Teams or any URL that accepts a JSON POST. Stored encrypted: anyone
    // holding a Slack webhook URL can post to that channel.
    alertWebhookUrl: { type: String, default: '' },
    // Alerts fire on a change — passing to failing, or back — never on every failed run,
    // so a monitor that fails every five minutes sends one alert, not 288 a day.
    alertState: { type: String, enum: ['ok', 'failing'], default: 'ok' },

    lastRunAt: { type: Date, default: null },
    // 'skipped' means it was due but could not start — the account already had the
    // maximum number of runs going — and is not a failure of the API under test.
    lastStatus: { type: String, enum: ['passed', 'failed', 'error', 'skipped', null], default: null },
    lastRunId: { type: Schema.Types.ObjectId, ref: 'TestRun', default: null },
    lastError: { type: String, default: null },
    lastDurationMs: { type: Number, default: null },
  },
  { timestamps: true },
);

// One account's monitors, in the order they were made.
monitorSchema.index({ userId: 1, createdAt: 1 });
// The scheduler's query: enabled monitors that are due.
monitorSchema.index({ enabled: 1, nextRunAt: 1 });

export const Monitor = mongoose.model('Monitor', monitorSchema);
