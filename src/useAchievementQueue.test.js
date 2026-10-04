/**
 * Tests for the achievement notification queue logic.
 * Covers both the pure deduplication helper (dedupeItems) and the
 * real useAchievementQueue hook via renderHook.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode, createElement } from 'react';
import { renderHook, act } from '@testing-library/react';
import { dedupeItems, useAchievementQueue } from './useAchievementQueue.js';

// ---------- dedupeItems (pure function) ----------

describe('dedupeItems', () => {
  /* The hook's own 'deduplicates repeated IDs across enqueue calls' test cannot
   * pass unless the common paths here work, so only the two behaviours it cannot
   * observe are pinned directly: within-batch collapsing, and the fact that this
   * helper MUTATES the set it is given rather than returning a new one. */

  it('deduplicates within a single batch', () => {
    const seen = new Set();
    const result = dedupeItems([{ id: 'a' }, { id: 'a' }], seen);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });

  it('adds accepted IDs to the set it was given', () => {
    const seen = new Set(['a']);
    const result = dedupeItems([{ id: 'a' }, { id: 'x' }], seen);
    expect(result.map(item => item.id)).toEqual(['x']);
    expect(seen.has('x')).toBe(true);
  });
});

// ---------- useAchievementQueue (real hook) ----------

describe('useAchievementQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with no current item', () => {
    const { result } = renderHook(() => useAchievementQueue(500));
    expect(result.current.current).toBeNull();
  });

  it('promotes the first enqueued item to current immediately', () => {
    const { result } = renderHook(() => useAchievementQueue(500));
    act(() => {
      result.current.enqueue({ id: 'first_release', name: 'First Release' });
    });
    expect(result.current.current?.id).toBe('first_release');
  });

  it('does not replace an already-showing item when more are enqueued', () => {
    const { result } = renderHook(() => useAchievementQueue(500));
    act(() => {
      result.current.enqueue({ id: 'a', name: 'A' });
    });
    act(() => {
      result.current.enqueue({ id: 'b', name: 'B' });
    });
    expect(result.current.current?.id).toBe('a');
  });

  it('advances to the next item after dismiss', () => {
    const { result } = renderHook(() => useAchievementQueue(500));
    act(() => {
      result.current.enqueue([
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ]);
    });
    expect(result.current.current?.id).toBe('a');
    act(() => {
      result.current.dismiss();
    });
    expect(result.current.current?.id).toBe('b');
  });

  it('clears current after the last item is dismissed', () => {
    const { result } = renderHook(() => useAchievementQueue(500));
    act(() => {
      result.current.enqueue({ id: 'a', name: 'A' });
    });
    act(() => {
      result.current.dismiss();
    });
    expect(result.current.current).toBeNull();
  });

  it('auto-advances after durationMs', () => {
    const { result } = renderHook(() => useAchievementQueue(500));
    act(() => {
      result.current.enqueue([
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ]);
    });
    expect(result.current.current?.id).toBe('a');
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.current?.id).toBe('b');
  });

  it('deduplicates repeated IDs across enqueue calls', () => {
    const { result } = renderHook(() => useAchievementQueue(500));
    act(() => {
      result.current.enqueue({ id: 'a', name: 'A' });
    });
    act(() => {
      result.current.dismiss();
    });
    // Re-enqueuing the same ID should be ignored.
    act(() => {
      result.current.enqueue({ id: 'a', name: 'A' });
    });
    expect(result.current.current).toBeNull();
  });

  it('preserves FIFO order across a batch of items', () => {
    const { result } = renderHook(() => useAchievementQueue(500));
    act(() => {
      result.current.enqueue([{ id: '1' }, { id: '2' }, { id: '3' }]);
    });
    expect(result.current.current?.id).toBe('1');
    act(() => {
      result.current.dismiss();
    });
    expect(result.current.current?.id).toBe('2');
    act(() => {
      result.current.dismiss();
    });
    expect(result.current.current?.id).toBe('3');
  });
});


describe('achievement queue under StrictMode', () => {
  it('never duplicates queued items when React replays state updaters', () => {
    const wrapper = ({ children }) => createElement(StrictMode, null, children);
    const { result } = renderHook(() => useAchievementQueue(5000), { wrapper });
    act(() => result.current.enqueue([{ id: 'a' }, { id: 'b' }]));
    act(() => result.current.enqueue({ id: 'c' }));
    const displayed = [];
    for (let i = 0; i < 5 && result.current.current; i++) {
      displayed.push(result.current.current.id);
      act(() => result.current.dismiss());
    }
    expect(displayed).toEqual(['a', 'b', 'c']);
  });
});
