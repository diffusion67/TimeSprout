'use strict';

const MAX_FUTURE_MS = 8 * 24 * 60 * 60 * 1000;
const REMINDER_GRACE_MS = 5 * 60 * 1000;

function shouldDeliverReminder(item, now = Date.now()) {
  return Number.isSafeInteger(item?.at) && item.at <= now && now - item.at <= REMINDER_GRACE_MS;
}

function normalizeReminders(value, now = Date.now(), includeRecentPast = false) {
  if (!Array.isArray(value)) return [];
  const ids = new Set();
  return value.filter(item => {
    if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 400 || ids.has(item.id)) return false;
    if (!Number.isSafeInteger(item.at) || (includeRecentPast ? item.at < now - REMINDER_GRACE_MS : item.at <= now) || item.at > now + MAX_FUTURE_MS) return false;
    if (typeof item.title !== 'string' || typeof item.body !== 'string' || item.title.length > 100 || item.body.length > 1000) return false;
    ids.add(item.id);
    return true;
  }).sort((a, b) => a.at - b.at);
}

module.exports = { normalizeReminders, shouldDeliverReminder, REMINDER_GRACE_MS };
