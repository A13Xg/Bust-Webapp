import { describe, it, expect } from 'vitest';

import { clampMenuToViewport } from './contextMenu.js';

const menu = { width: 150, height: 90 };
const viewport = { width: 1000, height: 800 };

describe('clampMenuToViewport', () => {
  it('opens at the cursor when there is room', () => {
    expect(clampMenuToViewport(300, 400, menu, viewport)).toEqual({ left: 300, top: 400 });
  });

  it('flips left of the cursor near the right edge', () => {
    expect(clampMenuToViewport(980, 400, menu, viewport).left).toBe(830);
  });

  it('flips above the cursor near the bottom edge', () => {
    expect(clampMenuToViewport(300, 790, menu, viewport).top).toBe(700);
  });

  it('never leaves the viewport in either corner', () => {
    for (const [x, y] of [
      [0, 0],
      [1000, 800],
      [-50, -50],
      [5000, 5000],
    ]) {
      const { left, top } = clampMenuToViewport(x, y, menu, viewport);
      expect(left).toBeGreaterThanOrEqual(8);
      expect(top).toBeGreaterThanOrEqual(8);
      expect(left + menu.width).toBeLessThanOrEqual(viewport.width);
      expect(top + menu.height).toBeLessThanOrEqual(viewport.height);
    }
  });

  it('stays on screen when the menu is taller than the viewport', () => {
    const { left, top } = clampMenuToViewport(10, 10, { width: 150, height: 2000 }, { width: 320, height: 400 });
    expect(left).toBe(10);
    expect(top).toBe(8);
  });

  it('degrades to the margin when it has not measured the menu yet', () => {
    expect(clampMenuToViewport(300, 400, null, viewport)).toEqual({ left: 300, top: 400 });
  });
});
