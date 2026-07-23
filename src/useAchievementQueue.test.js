/**
 * Tests for the achievement notification queue logic.
 * Covers both the pure deduplication helper (dedupeItems) and the
 * real useAchievementQueue hook via renderHook.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { dedupeItems, useAchievementQueue } from './useAchievementQueue.js';

// ---------- dedupeItems (pure function) ----------

describe('dedupeItems', () => {
  it('passes through all items when the set is empty', () => {
    const seen = new Set();
    expect(dedupeItems([{ id: 'a' }, { id: 'b' }], seen)).toHaveLength(2);
  });

  it('blocks IDs already in the set', () => {
    const seen = new Set(['a']);
    expect(dedupeItems([{ id: 'a' }], seen)).toHaveLength(0);
  });

  it('deduplicates within a single batch', () => {
    const seen = new Set();
    const result = dedupeItems([{ id: 'a' }, { id: 'a' }], seen);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });

  it('blocks duplicates across successive calls', () => {
    const seen = new Set();
    dedupeItems([{ id: 'a' }], seen);
    expect(dedupeItems([{ id: 'a' }], seen)).toHaveLength(0);
  });

  it('lets different IDs through after partial dedupe', () => {
    const seen = new Set(['a']);
    const result = dedupeItems([{ id: 'a' }, { id: 'b' }], seen);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('b');
  });

  it('adds accepted IDs to the set', () => {
    const seen = new Set();
    dedupeItems([{ id: 'x' }], seen);
    expect(seen.has('x')).toBe(true);
  });
});

// ---------- useAchievementQueue (real hook) ----------

describe('useAchievementQueue', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('starts with no current item', () => {
    const { result } = renderHook(() => useAchievementQueue(500));
    expect(result.current.current).toBeNull();
  });

  it('promotes the first enqueued item to current immediately', () => {
    const { result } = renderHook(() => useAchievementQueue(500));
    act(() => { result.current.enqueue({ id: 'first_release', name: 'First Release' }); });
    expect(result.current.current?.id).toBe('first_release');
  });

  it('does not replace an already-showing item when more are enqueued', () => {
    const { result } = renderHook(() => useAchievementQueue(500));
    act(() => { result.current.enqueue({ id: 'a', name: 'A' }); });
    act(() => { result.current.enqueue({ id: 'b', name: 'B' }); });
    expect(result.current.current?.id).toBe('a');
  });

  it('advances to the next item after dismiss', () => {
    const { result } = renderHook(() => useAchievementQueue(500));
    act(() => { result.current.enqueue([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]); });
    expect(result.current.current?.id).toBe('a');
    act(() => { result.current.dismiss(); });
    expect(result.current.current?.id).toBe('b');
  });

  it('clears current after the last item is dismissed', () => {
    const { result } = renderHook(() => useAchievementQueue(500));
    act(() => { result.current.enqueue({ id: 'a', name: 'A' }); });
    act(() => { result.current.dismiss(); });
    expect(result.current.current).toBeNull();
  });

  it('auto-advances after durationMs', () => {
    const { result } = renderHook(() => useAchievementQueue(500));
    act(() => { result.current.enqueue([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]); });
    expect(result.current.current?.id).toBe('a');
    act(() => { vi.advanceTimersByTime(500); });
    expect(result.current.current?.id).toBe('b');
  });

  it('deduplicates repeated IDs across enqueue calls', () => {
    const { result } = renderHook(() => useAchievementQueue(500));
    act(() => { result.current.enqueue({ id: 'a', name: 'A' }); });
    act(() => { result.current.dismiss(); });
    // Re-enqueuing the same ID should be ignored.
    act(() => { result.current.enqueue({ id: 'a', name: 'A' }); });
    expect(result.current.current).toBeNull();
  });

  it('preserves FIFO order across a batch of items', () => {
    const { result } = renderHook(() => useAchievementQueue(500));
    act(() => { result.current.enqueue([{ id: '1' }, { id: '2' }, { id: '3' }]); });
    expect(result.current.current?.id).toBe('1');
    act(() => { result.current.dismiss(); });
    expect(result.current.current?.id).toBe('2');
    act(() => { result.current.dismiss(); });
    expect(result.current.current?.id).toBe('3');
  });
});
