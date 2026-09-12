import { describe, it, expect } from 'vitest';
import { ACHIEVEMENT_ANNOUNCE_COOLDOWN_MS, achievementSlotId } from './pushCooldown.js';

describe('achievement announce cooldown', () => {
  const actor = '11111111-2222-3333-4444-555555555555';

  it('gives the same slot id to a burst inside one window', () => {
    const base = 1_700_000_000_000;
    expect(achievementSlotId(actor, base)).toBe(achievementSlotId(actor, base + 1_000));
  });

  it('gives a different slot id once the cooldown has elapsed', () => {
    // Anchored to a window boundary so the +cooldown step cannot land in the
    // same bucket by accident.
    const base = Math.ceil(1_700_000_000_000 / ACHIEVEMENT_ANNOUNCE_COOLDOWN_MS) * ACHIEVEMENT_ANNOUNCE_COOLDOWN_MS;
    expect(achievementSlotId(actor, base)).not.toBe(achievementSlotId(actor, base + ACHIEVEMENT_ANNOUNCE_COOLDOWN_MS));
  });

  it('never collides between two actors in the same window', () => {
    const base = 1_700_000_000_000;
    const other = '99999999-8888-7777-6666-555555555555';
    expect(achievementSlotId(actor, base)).not.toBe(achievementSlotId(other, base));
  });

  it('is namespaced so it can never collide with a real achievement row id', () => {
    expect(achievementSlotId(actor, 1_700_000_000_000).startsWith('slot:')).toBe(true);
  });

  it('holds the gate shut for ten minutes', () => {
    expect(ACHIEVEMENT_ANNOUNCE_COOLDOWN_MS).toBe(10 * 60 * 1000);
  });
});
