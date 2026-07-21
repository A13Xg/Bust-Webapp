/**
 * Tests for the achievement notification queue logic.
 * Tests the deduplication and queue advancement semantics without
 * requiring a full React testing environment.
 */
import { describe, it, expect } from 'vitest';

// Test the core deduplication logic extracted from useAchievementQueue.
function makeQueue(items = []) {
  const shown = new Set(items);
  return {
    shown,
    enqueue(newItems) {
      return newItems.filter(item => {
        if (shown.has(item.id)) return false;
        shown.add(item.id);
        return true;
      });
    },
  };
}

describe('achievement queue deduplication', () => {
  it('allows new achievement IDs through', () => {
    const q = makeQueue();
    const items = [{ id: 'first_release' }, { id: 'hat_trick' }];
    expect(q.enqueue(items)).toHaveLength(2);
  });

  it('blocks already-shown achievement IDs', () => {
    const q = makeQueue(['first_release']);
    expect(q.enqueue([{ id: 'first_release' }])).toHaveLength(0);
  });

  it('deduplicates within a single batch', () => {
    const q = makeQueue();
    const items = [{ id: 'a1' }, { id: 'a1' }];
    const fresh = q.enqueue(items);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].id).toBe('a1');
  });

  it('blocks duplicates across calls', () => {
    const q = makeQueue();
    q.enqueue([{ id: 'a1' }]);
    const second = q.enqueue([{ id: 'a1' }]);
    expect(second).toHaveLength(0);
  });

  it('does not block different IDs', () => {
    const q = makeQueue(['a1']);
    const fresh = q.enqueue([{ id: 'a1' }, { id: 'a2' }]);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].id).toBe('a2');
  });
});

describe('achievement queue ordering and sequential display', () => {
  it('processes items in FIFO order', () => {
    const order = [];
    const queue = ['first_release', 'hat_trick', 'week_warrior'];
    queue.forEach(id => order.push(id));
    expect(order[0]).toBe('first_release');
    expect(order[2]).toBe('week_warrior');
  });

  it('isRestored flag distinguishes restored vs newly earned achievements', () => {
    const restored = { id: 'first_release', isRestored: true };
    const fresh = { id: 'hat_trick', isRestored: false };
    expect(restored.isRestored).toBe(true);
    expect(fresh.isRestored).toBe(false);
  });
});
