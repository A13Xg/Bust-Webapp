/*
 * Turns the flat delivery log into what the debug menu's DELIVERY tab shows.
 *
 * The server stores one row per (fan-out, recipient) because that is the grain
 * an acknowledgement arrives at — one device confirms one notification. A human
 * reading the log wants the other grain: one line per event, "Alex busted · sent
 * 4 · received 3". This does that fold, and does it in the browser so the
 * headline totals and the running log can never disagree about what they counted.
 *
 * "received" means a service worker called back. It is a floor, not a truth: a
 * device that is offline, or whose worker was killed before the fetch landed,
 * shows as unconfirmed even though the notification may be sitting on the lock
 * screen. Never read a gap as proof of non-delivery.
 */

/**
 * @param {Array<{batchId: string, kind: string, title: string, actorName: string,
 *   recipientName: string, sentAt: string, ackedAt: string|null}>} deliveries
 */
export function summarizeDeliveries(deliveries = []) {
  const rows = Array.isArray(deliveries) ? deliveries : [];
  const byBatch = new Map();

  for (const row of rows) {
    let event = byBatch.get(row.batchId);
    if (!event) {
      event = {
        batchId: row.batchId,
        kind: row.kind,
        title: row.title,
        actorName: row.actorName,
        sentAt: row.sentAt,
        sent: 0,
        received: 0,
        recipients: [],
      };
      byBatch.set(row.batchId, event);
    }
    event.sent += 1;
    if (row.ackedAt) event.received += 1;
    // The fan-out is concurrent, so rows in one batch carry send timestamps a
    // few milliseconds apart. The event happened when the first one went out.
    if (row.sentAt < event.sentAt) event.sentAt = row.sentAt;
    event.recipients.push({ name: row.recipientName, received: Boolean(row.ackedAt) });
  }

  const events = [...byBatch.values()].sort((a, b) => (a.sentAt < b.sentAt ? 1 : a.sentAt > b.sentAt ? -1 : 0));
  return {
    totals: {
      sent: rows.length,
      received: rows.filter(row => row.ackedAt).length,
    },
    events,
  };
}
