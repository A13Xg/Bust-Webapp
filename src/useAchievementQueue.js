import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Filters `items` to those whose `id` is not already in `seenSet`, adding each
 * accepted id to `seenSet` as a side effect. Deterministic helper; not a pure
 * function because it mutates `seenSet`.
 */
export function dedupeItems(items, seenSet) {
  const out = [];
  for (const item of items) {
    if (!seenSet.has(item.id)) {
      seenSet.add(item.id);
      out.push(item);
    }
  }
  return out;
}

/**
 * useAchievementQueue — sequential achievement toast display.
 *
 * Rules:
 * - Only one achievement toast is shown at a time.
 * - New unlocks are appended to an internal queue and shown in order.
 * - Each toast auto-dismisses after `durationMs`.
 * - IDs already shown in this session are deduplicated so reconnects and
 *   dashboard reconciliation do not replay the same toast.
 * - Returns { current, enqueue, dismiss }.
 */
export function useAchievementQueue(durationMs = 5200) {
  const [queue, setQueue] = useState([]);
  const [current, setCurrent] = useState(null);
  const timerRef = useRef(null);
  // Track IDs shown during this session to avoid replaying restored achievements.
  const shownIds = useRef(new Set());

  const advance = useCallback(() => {
    setQueue(prev => {
      if (!prev.length) {
        setCurrent(null);
        return prev;
      }
      const [next, ...rest] = prev;
      setCurrent(next);
      return rest;
    });
  }, []);

  // When `current` changes, schedule its auto-dismiss.
  useEffect(() => {
    if (!current) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setCurrent(null);
      advance();
    }, durationMs);
    return () => clearTimeout(timerRef.current);
  }, [current, durationMs, advance]);

  /**
   * Enqueue one or more achievement item objects.
   * Pass `{ isRestored: true }` to mark an item as historically backfilled so
   * the UI can style or label it differently.
   *
   * Uses a single `setCurrent` updater to atomically decide whether to promote
   * the first fresh item to `current` (nothing showing) or append all items to
   * the queue (something already showing), avoiding React-batching race conditions.
   */
  const enqueue = useCallback(items => {
    const arr = Array.isArray(items) ? items : [items];
    const fresh = dedupeItems(arr, shownIds.current);
    if (!fresh.length) return;
    setCurrent(prev => {
      if (prev) {
        // Something is already showing — append all fresh items to the queue.
        setQueue(q => [...q, ...fresh]);
        return prev;
      }
      // Nothing is showing — show the head immediately and queue the rest.
      const [head, ...tail] = fresh;
      if (tail.length) setQueue(q => [...q, ...tail]);
      return head;
    });
  }, []);

  const dismiss = useCallback(() => {
    clearTimeout(timerRef.current);
    setCurrent(null);
    advance();
  }, [advance]);

  return { current, enqueue, dismiss };
}
