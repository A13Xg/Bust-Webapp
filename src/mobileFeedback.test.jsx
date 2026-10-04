import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Overlay } from './Overlay.jsx';
import { BadgeToast } from './BadgeToast.jsx';
import { Explosion } from './Explosion.jsx';
import { haptic, setHapticsEnabled } from './haptics.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('drawer dismissal', () => {
  it('portals out of transformed ancestors and keeps the X outside scrolling content', () => {
    const close = vi.fn();
    const { container } = render(
      <div style={{ transform: 'translateX(1px)' }}>
        <Overlay title="Analytics" onClose={close}>
          <button>Content action</button>
        </Overlay>
      </div>
    );
    expect(container.querySelector('.overlay')).toBeNull();
    const button = screen.getByRole('button', { name: 'Close Analytics' });
    expect(button.closest('.overlay-content')).toBeNull();
    expect(document.activeElement).toBe(button);
    fireEvent.click(screen.getByText('Content action'));
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector('.dashboard-scrim'));
    expect(close).toHaveBeenCalledTimes(1);
    fireEvent.click(button);
    expect(close).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(3);
  });
  it('restores focus and body scrolling after unmount', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    document.body.style.overflow = 'auto';
    const { unmount } = render(
      <Overlay title="Profile" onClose={() => {}}>
        Profile content
      </Overlay>
    );
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('auto');
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
    document.body.style.overflow = '';
  });
});

describe('achievement feedback', () => {
  it('announces complete award text in a viewport portal with matching sparkles', () => {
    const { container, rerender } = render(
      <BadgeToast
        badge={{ id: 'gold', name: 'A very long achievement name', tier: 'gold', points: 50, accent: '#ffd166' }}
      />
    );
    expect(container.querySelector('.badge-toast')).toBeNull();
    const toast = screen.getByRole('status');
    expect(toast.textContent).toContain('A very long achievement name');
    expect(toast.textContent).toContain('GOLD · 50 XP');
    expect(toast.style.getPropertyValue('--award-color')).toBe('#ffd166');
    expect(toast.querySelector('.award-sparkles')).not.toBeNull();
    rerender(<BadgeToast badge={{ id: 'restored', isRestorationSummary: true, restoredCount: 12 }} />);
    expect(screen.getByRole('status').textContent).toContain('12 historical achievements restored');
    expect(document.querySelector('.award-sparkles')).toBeNull();
  });
  it('does not reroll droplets when the dashboard re-renders', () => {
    const { rerender } = render(<Explosion />);
    const before = [...document.querySelectorAll('.liquid-drop, .liquid-splat')].map(el => el.getAttribute('style'));
    rerender(<Explosion />);
    expect([...document.querySelectorAll('.liquid-drop, .liquid-splat')].map(el => el.getAttribute('style'))).toEqual(
      before
    );
  });
});

describe('best-effort haptics', () => {
  it('respects opt-out and reduced motion', () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal('navigator', { vibrate });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(haptic('bust')).toBe(true);
    setHapticsEnabled(false);
    vibrate.mockClear();
    expect(haptic('bust')).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
    setHapticsEnabled(true);
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(haptic('achievement')).toBe(false);
    vi.unstubAllGlobals();
  });
  it('cannot abort a bust if vibration is absent or throws', () => {
    vi.stubGlobal('navigator', {});
    expect(haptic('charge')).toBe(false);
    vi.stubGlobal('navigator', {
      vibrate: () => {
        throw new Error('blocked');
      },
    });
    expect(haptic('bust')).toBe(false);
    vi.unstubAllGlobals();
  });
});
