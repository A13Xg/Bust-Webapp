import { describe, it, expect } from 'vitest';
import { summarizeDeliveries } from './pushDeliveryReport.js';

const row = (over = {}) => ({
  batchId: 'b1',
  kind: 'bust',
  title: 'Alex busted',
  actorName: 'Alex',
  recipientName: 'Sam',
  sentAt: '2026-09-12T10:00:00.000Z',
  ackedAt: null,
  ...over,
});

describe('summarizeDeliveries', () => {
  it('counts every delivery as sent and only acknowledged ones as received', () => {
    const report = summarizeDeliveries([
      row({ recipientName: 'Sam', ackedAt: '2026-09-12T10:00:04.000Z' }),
      row({ recipientName: 'Jo' }),
      row({ recipientName: 'Kim', ackedAt: '2026-09-12T10:00:09.000Z' }),
    ]);
    expect(report.totals).toEqual({ sent: 3, received: 3 - 1 });
  });

  it('groups one fan-out into a single row carrying its own sent/received', () => {
    const report = summarizeDeliveries([
      row({ batchId: 'b1', ackedAt: '2026-09-12T10:00:04.000Z' }),
      row({ batchId: 'b1' }),
      row({ batchId: 'b2', kind: 'achievement', title: 'Sam unlocked Night Ops', actorName: 'Sam' }),
    ]);
    expect(report.events).toHaveLength(2);
    expect(report.events[0]).toMatchObject({ batchId: 'b1', actorName: 'Alex', kind: 'bust', sent: 2, received: 1 });
    expect(report.events[1]).toMatchObject({
      batchId: 'b2',
      actorName: 'Sam',
      kind: 'achievement',
      sent: 1,
      received: 0,
    });
  });

  it('orders events newest first regardless of input order', () => {
    const report = summarizeDeliveries([
      row({ batchId: 'old', sentAt: '2026-09-01T10:00:00.000Z' }),
      row({ batchId: 'new', sentAt: '2026-09-12T10:00:00.000Z' }),
      row({ batchId: 'mid', sentAt: '2026-09-06T10:00:00.000Z' }),
    ]);
    expect(report.events.map(event => event.batchId)).toEqual(['new', 'mid', 'old']);
  });

  it('reports the earliest send in a batch as the event time', () => {
    const report = summarizeDeliveries([
      row({ sentAt: '2026-09-12T10:00:07.000Z' }),
      row({ sentAt: '2026-09-12T10:00:02.000Z' }),
    ]);
    expect(report.events[0].sentAt).toBe('2026-09-12T10:00:02.000Z');
  });

  it('lists who received each event so a row can name its recipients', () => {
    const report = summarizeDeliveries([
      row({ recipientName: 'Sam', ackedAt: '2026-09-12T10:00:04.000Z' }),
      row({ recipientName: 'Jo' }),
    ]);
    expect(report.events[0].recipients).toEqual([
      { name: 'Sam', received: true },
      { name: 'Jo', received: false },
    ]);
  });

  it('survives an empty or missing log', () => {
    expect(summarizeDeliveries([])).toEqual({ totals: { sent: 0, received: 0 }, events: [] });
    expect(summarizeDeliveries()).toEqual({ totals: { sent: 0, received: 0 }, events: [] });
  });
});
