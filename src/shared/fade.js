/**
 * TabSum - Fade policy.
 *
 * When a saved note deletes itself, and how long before that we warn about it. Pure: the
 * storage module walks the records and the UI draws the chip, but the rule lives here, so
 * neither has to import the other to know it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** A note shows its "Fades in Nd" chip once it is this close to going. */
export const FADE_WARNING_DAYS = 3;

/**
 * When a note fades (ms timestamp), or null if it never does. Unopened notes fade
 * fadeUnopenedDays after capture; reopened notes fadeReopenedDays after the last reopen.
 * Starred notes and a 0-day setting never fade.
 */
export function getExpiry(record, settings) {
  // An absent settings object means we cannot know the windows, so treat the note as
  // never-fading rather than throwing. `= {}` would not cover this: callers pass an
  // explicit null (getArchivedTabs' default, and app.js's getSettings().catch(() => null)).
  if (!settings) return null;
  if (record.isFavorite) return null;
  const days = record.restoredAt ? settings.fadeReopenedDays : settings.fadeUnopenedDays;
  if (!days) return null;
  return (record.restoredAt || record.capturedAt) + days * DAY_MS;
}

/**
 * Chip text for a note, or '' when it should not show one: never-fading notes, and fading
 * notes still further out than the warning window (unless the user is sorting by fade date,
 * where the whole point is seeing every one of them).
 */
export function fadeChipLabel(record, settings, sortBy, now = Date.now()) {
  const expiry = settings ? getExpiry(record, settings) : null;
  if (expiry === null) return '';
  const daysLeft = (expiry - now) / DAY_MS;
  if (sortBy !== 'expiring-soon' && daysLeft > FADE_WARNING_DAYS) return '';
  return daysLeft < 1 ? 'Fades today' : `Fades in ${Math.ceil(daysLeft)}d`;
}
