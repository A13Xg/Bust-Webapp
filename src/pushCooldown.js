/*
 * Per-actor cooldown on achievement announcements.
 *
 * One bust can mint several achievements at once, and a re-reconciliation can
 * mint a whole backlog. Without a cap the crew receives one push per row — the
 * observed worst case was 13 announcements in a single sweep.
 *
 * The client already narrows a bust down to one announceable unlock
 * (`pickAnnounceableUnlock` in rules.js), but that alone is not enough: every
 * row the client declined to announce is still sitting in `achievements` inside
 * dispatch-push-backstop's lookback window, and the backstop would announce all
 * of them on its next run. So the cap has to be enforced server-side too.
 *
 * The server enforces it by claiming a slot id in `push_events`, whose
 * `unique (kind, source_id)` index makes the claim atomic. That matters because
 * the client fires its announcements concurrently (main.jsx's announceToCrew is
 * fire-and-forget), so a read-then-write check would let every caller in a burst
 * read zero and all of them send.
 *
 * Slots are fixed windows rather than "10 minutes since the last send", which
 * means a burst straddling a boundary can announce twice. Unlocks from one bust
 * land within seconds of each other, so that is rare, and the client-side cap is
 * the primary control — this is the backstop's safety net.
 */

export const ACHIEVEMENT_ANNOUNCE_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * Identifies one actor's announcement window. Prefixed so it can never collide
 * with a real achievement row id in the shared `push_events.source_id` column.
 *
 * @param {string} actorId
 * @param {number} now epoch ms
 * @returns {string}
 */
export function achievementSlotId(actorId, now = Date.now()) {
  return `slot:${actorId}:${Math.floor(now / ACHIEVEMENT_ANNOUNCE_COOLDOWN_MS)}`;
}
