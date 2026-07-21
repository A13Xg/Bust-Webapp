import { useCallback, useEffect, useRef, useState } from 'react';

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
   */
  const enqueue = useCallback(items => {
    const arr = Array.isArray(items) ? items : [items];
    const fresh = arr.filter(item => !shownIds.current.has(item.id));
    fresh.forEach(item => shownIds.current.add(item.id));
    if (!fresh.length) return;
    setQueue(prev => {
      const next = [...prev, ...fresh];
      return next;
    });
    // If nothing is currently showing, trigger immediately.
    setCurrent(prev => {
      if (prev) return prev;
      const [head, ...tail] = fresh;
      setQueue(q => [...q.slice(fresh.length - tail.length), ...tail]);
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
