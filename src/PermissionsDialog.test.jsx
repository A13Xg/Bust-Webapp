import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { PermissionsDialog } from './PermissionsDialog.jsx';
import { DONT_ASK_KEY, SESSION_SEEN_KEY } from './permissionPrefs.js';
import { OUTCOME } from './permissionRequests.js';

const click = label => fireEvent.click(screen.getByText(label));
const row = name => screen.getByText(name).closest('.perm-row');

function setup({ location = OUTCOME.granted, push = { ok: true }, order = [] } = {}) {
  const onDone = vi.fn();
  const install = { show: vi.fn(async () => ({ outcome: 'installed', guide: null })) };
  const requestLocationFn = vi.fn(async () => {
    order.push('location');
    return {
      outcome: location,
      coords: location === OUTCOME.granted ? { lat: 1, long: 2, altitude: null, at: 1 } : null,
    };
  });
  const enablePush = vi.fn(async () => {
    order.push('notifications');
    return typeof push === 'function' ? push() : push;
  });
  render(
    <PermissionsDialog
      onDone={onDone}
      install={install}
      enablePush={enablePush}
      getNotificationPermission={() => 'default'}
      requestLocationFn={requestLocationFn}
    />
  );
  return { onDone, install, requestLocationFn, enablePush };
}

describe('PermissionsDialog', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('opens on the why phase, with no way to close it', () => {
    setup();
    expect(document.querySelector('.perm-why')).toBeTruthy();
    expect(screen.queryByText('Allow Notifications')).toBeNull();
    // No X: the user must make a choice.
    expect(document.querySelector('.perm-box .detail-close')).toBeNull();
  });

  it('advances to the choices, all three checked and opt-out clear', () => {
    setup();
    click('OKAY');
    const boxes = document.querySelectorAll('.perm-check input');
    expect(boxes.length).toBe(4);
    expect([...boxes].map(b => b.checked)).toEqual([true, true, true, false]);
    expect(document.querySelector('.perm-check-hero')).toBeTruthy(); // Install App is the prominent one
  });

  /* Order matters: two native prompts at once and the browser drops one. */
  it('asks for location first, then notifications, one after the other', async () => {
    const order = [];
    setup({ order });
    click('OKAY');
    click('ACCEPT');
    await waitFor(() => expect(order).toEqual(['location', 'notifications']));
  });

  it('reports both as enabled when both are granted', async () => {
    setup();
    click('OKAY');
    click('ACCEPT');
    await waitFor(() => expect(row('Location').className).toContain('ok'));
    expect(row('Notifications').className).toContain('ok');
    expect(screen.queryByText('RETRY')).toBeNull();
  });

  it('offers retry on a timeout, and retrying can succeed', async () => {
    let outcome = OUTCOME.timeout;
    const onDone = vi.fn();
    const requestLocationFn = vi.fn(async () => ({
      outcome,
      coords: outcome === OUTCOME.granted ? { lat: 1, long: 2, altitude: null, at: 1 } : null,
    }));
    render(
      <PermissionsDialog
        onDone={onDone}
        install={{ show: vi.fn() }}
        enablePush={async () => ({ ok: true })}
        getNotificationPermission={() => 'default'}
        requestLocationFn={requestLocationFn}
      />
    );
    click('OKAY');
    click('ACCEPT');

    await waitFor(() => expect(row('Location').className).toContain('bad'));
    expect(screen.getByText('RETRY')).toBeTruthy();

    outcome = OUTCOME.granted;
    click('RETRY');
    await waitFor(() => expect(row('Location').className).toContain('ok'));
  });

  it('tries an unresolved permission three times, then unlocks OKAY after a short delay', async () => {
    vi.useFakeTimers();
    try {
      const requestLocationFn = vi.fn(async () => ({ outcome: OUTCOME.timeout, coords: null }));
      render(
        <PermissionsDialog
          onDone={vi.fn()}
          install={{ show: vi.fn() }}
          enablePush={async () => ({ ok: true })}
          getNotificationPermission={() => 'granted'}
          requestLocationFn={requestLocationFn}
        />
      );
      click('OKAY');
      click('ACCEPT');

      await vi.waitFor(() => expect(requestLocationFn).toHaveBeenCalledTimes(3));
      expect(screen.getByText('RETRY')).toBeTruthy();
      expect(screen.getByText('OKAY').disabled).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(screen.getByText('OKAY').disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('recovers when a permission API never settles', async () => {
    vi.useFakeTimers();
    try {
      const requestLocationFn = vi.fn(() => new Promise(() => {}));
      render(
        <PermissionsDialog
          onDone={vi.fn()}
          install={{ show: vi.fn() }}
          enablePush={async () => ({ ok: true })}
          getNotificationPermission={() => 'granted'}
          requestLocationFn={requestLocationFn}
        />
      );
      click('OKAY');
      click('ACCEPT');

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(6000);
        });
      }
      expect(requestLocationFn).toHaveBeenCalledTimes(3);
      expect(screen.getByText('RETRY')).toBeTruthy();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(screen.getByText('OKAY').disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out each notification attempt after three seconds', async () => {
    vi.useFakeTimers();
    try {
      const enablePush = vi.fn(() => new Promise(() => {}));
      render(
        <PermissionsDialog
          onDone={vi.fn()}
          install={{ show: vi.fn() }}
          enablePush={enablePush}
          getNotificationPermission={() => 'default'}
          requestLocationFn={async () => ({ outcome: OUTCOME.granted, coords: null })}
        />
      );
      click('OKAY');
      click('ACCEPT');

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(3000);
        });
      }
      expect(enablePush).toHaveBeenCalledTimes(3);
      expect(row('Notifications').className).toContain('bad');
    } finally {
      vi.useRealTimers();
    }
  });

  /* A denial cannot be re-prompted, so a RETRY button there would do nothing. */
  it('shows no retry for a denial, only the settings hint', async () => {
    setup({ location: OUTCOME.denied });
    click('OKAY');
    click('ACCEPT');
    await waitFor(() => expect(row('Location').className).toContain('bad'));
    expect(row('Location').querySelector('.perm-retry')).toBeNull();
    expect(row('Location').textContent).toMatch(/site settings/i);
  });

  it('treats a dismissed notification prompt as retryable', async () => {
    setup({ push: { ok: false, permission: 'default' } });
    click('OKAY');
    click('ACCEPT');
    await waitFor(() => expect(row('Notifications').className).toContain('bad'));
    expect(row('Notifications').querySelector('.perm-retry')).toBeTruthy();
  });

  it('shows an install requirement when notifications are not supported', async () => {
    setup({ push: { ok: false, permission: 'unsupported' } });
    click('OKAY');
    click('ACCEPT');
    await waitFor(() => expect(row('Notifications').textContent).toContain('NOT SUPPORTED'));
    expect(row('Notifications').textContent).toContain('Must Install App');
    expect(row('Notifications').querySelector('.perm-row-install-required')).toBeTruthy();
  });

  it('suggests manual allowing when notification checks time out', async () => {
    setup({ push: () => null });
    click('OKAY');
    click('ACCEPT');
    await waitFor(() => expect(row('Notifications').textContent).toContain('TIMED OUT'));
    expect(row('Notifications').textContent).toContain('Try Manual Allowing');
  });

  it('only asks for what was checked', async () => {
    const { requestLocationFn, enablePush } = setup();
    click('OKAY');
    fireEvent.click(document.querySelectorAll('.perm-check input')[1]); // uncheck location
    click('ACCEPT');
    await waitFor(() => expect(enablePush).toHaveBeenCalled());
    expect(requestLocationFn).not.toHaveBeenCalled();
    expect(screen.queryByText('Location')).toBeNull();
  });

  /* Install must not run while a permission prompt is on screen. */
  it('installs only on the final OKAY, never on ACCEPT', async () => {
    const { install, onDone } = setup();
    click('OKAY');
    click('ACCEPT');
    await waitFor(() => expect(row('Notifications').className).toContain('ok'));
    expect(install.show).not.toHaveBeenCalled();

    click('OKAY');
    expect(install.show).toHaveBeenCalledTimes(1);
    // Closing now waits for the install prompt to resolve, so onDone is async.
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('skips installing when Install App was unchecked', async () => {
    const { install } = setup();
    click('OKAY');
    fireEvent.click(document.querySelectorAll('.perm-check input')[2]); // uncheck install
    click('ACCEPT');
    await waitFor(() => expect(row('Notifications').className).toContain('ok'));
    click('OKAY');
    expect(install.show).not.toHaveBeenCalled();
  });

  it('persists the opt-out on accept, before the prompts have finished', async () => {
    setup();
    click('OKAY');
    fireEvent.click(document.querySelectorAll('.perm-check input')[3]); // don't ask me again
    click('ACCEPT');
    await waitFor(() => expect(row('Notifications').className).toContain('ok'));
    expect(localStorage.getItem(DONT_ASK_KEY)).toBe('1');
    expect(sessionStorage.getItem(SESSION_SEEN_KEY)).toBe('1');
  });

  it('does not suppress future prompts without an explicit opt-out', async () => {
    const { requestLocationFn, enablePush } = setup();
    click('OKAY');
    click('ACCEPT');
    await waitFor(() => expect(row('Notifications').className).toContain('ok'));
    expect(localStorage.getItem(DONT_ASK_KEY)).toBeNull();
    expect(sessionStorage.getItem(SESSION_SEEN_KEY)).toBeNull();
    expect(requestLocationFn).toHaveBeenCalled();
    expect(enablePush).toHaveBeenCalled();
  });

  /* The documented full opt-out: uncheck both permissions, tick don't-ask, accept. */
  it('closes straight away with nothing checked, asking for no permissions', async () => {
    const { onDone, install, requestLocationFn, enablePush } = setup();
    click('OKAY');
    const boxes = document.querySelectorAll('.perm-check input');
    fireEvent.click(boxes[0]); // notifications off
    fireEvent.click(boxes[1]); // location off
    fireEvent.click(boxes[2]); // install off
    fireEvent.click(boxes[3]); // don't ask again on
    click('ACCEPT');

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(requestLocationFn).not.toHaveBeenCalled();
    expect(enablePush).not.toHaveBeenCalled();
    expect(install.show).not.toHaveBeenCalled();
    expect(localStorage.getItem(DONT_ASK_KEY)).toBe('1');
  });

  it('still offers install when permissions were declined but install was not', async () => {
    const { install, onDone } = setup();
    click('OKAY');
    const boxes = document.querySelectorAll('.perm-check input');
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    click('ACCEPT');
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(install.show).toHaveBeenCalledTimes(1);
  });

  it('hands the install guide up so it can be shown in the lightbox', async () => {
    const onDone = vi.fn();
    render(
      <PermissionsDialog
        onDone={onDone}
        install={{ show: async () => ({ outcome: 'instructions', guide: '/assets/images/iOS_webappGuide.png' }) }}
        enablePush={async () => ({ ok: true })}
        getNotificationPermission={() => 'default'}
        requestLocationFn={async () => ({ outcome: OUTCOME.granted, coords: null })}
      />
    );
    click('OKAY');
    click('ACCEPT');
    await waitFor(() => expect(row('Notifications').className).toContain('ok'));
    click('OKAY');
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ guide: '/assets/images/iOS_webappGuide.png' }));
  });

  it('reports no guide when the native prompt installed the app', async () => {
    const { onDone } = setup();
    click('OKAY');
    click('ACCEPT');
    await waitFor(() => expect(row('Notifications').className).toContain('ok'));
    click('OKAY');
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ guide: null }));
  });

  /* No close button, so a throw here would strand the user permanently. */
  it('still closes when the install hook throws', async () => {
    const onDone = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <PermissionsDialog
        onDone={onDone}
        install={{
          show: () => {
            throw new Error('platform sniff exploded');
          },
        }}
        enablePush={async () => ({ ok: true })}
        getNotificationPermission={() => 'default'}
        requestLocationFn={async () => ({ outcome: OUTCOME.granted, coords: null })}
      />
    );
    click('OKAY');
    click('ACCEPT');
    await waitFor(() => expect(row('Notifications').className).toContain('ok'));
    click('OKAY');
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ guide: null }));
    expect(warn).toHaveBeenCalledWith('[install] failed', expect.any(Error));
    warn.mockRestore();
  });
});
