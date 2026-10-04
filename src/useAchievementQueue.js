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

/** A single FIFO state keeps updaters pure even when React replays them. */
export function useAchievementQueue(durationMs = 5200) {
  const [queue, setQueue] = useState([]);
  const shownIds = useRef(new Set());
  const current = queue[0] || null;
  const dismiss = useCallback(() => setQueue(prev => prev.slice(1)), []);
  const enqueue = useCallback(items => {
    const fresh = dedupeItems(Array.isArray(items) ? items : [items], shownIds.current);
    if (fresh.length) setQueue(prev => [...prev, ...fresh]);
  }, []);
  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(dismiss, durationMs);
    return () => clearTimeout(timer);
  }, [current, durationMs, dismiss]);
  return { current, enqueue, dismiss };
}
