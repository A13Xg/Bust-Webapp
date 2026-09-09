import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const broadcastTestNotification = vi.fn();
const adminSetPassword = vi.fn();
vi.mock('./backend.js', () => ({ backend: { broadcastTestNotification, adminSetPassword } }));

const { DebugMenu } = await import('./DebugMenu.jsx');
const { achievements } = await import('./rules.js');

const debug = {
  xp: 0,
  setXp: vi.fn(),
  onBust: vi.fn(),
  onUnlock: vi.fn(),
  onClear: vi.fn(),
  onResetCooldown: vi.fn(),
  counts: { busts: 0, unlocks: 0 },
};

const crew = [
  { id: 'u-2', username: 'Zoe' },
  { id: 'u-1', username: 'Ann' },
];

const open = () =>
  render(<DebugMenu debug={debug} username="AlexG" users={crew} logoSrc="/bust-logo.png" onClose={vi.fn()} />);

const tab = name => screen.getByRole('tab', { name });

describe('DebugMenu', () => {
  beforeEach(() => {
    broadcastTestNotification.mockReset();
    adminSetPassword.mockReset();
    adminSetPassword.mockResolvedValue({ ok: true, username: 'Ann' });
    broadcastTestNotification.mockResolvedValue({ ok: true, attempted: 3, delivered: 3 });
  });

  it('opens on the bust tab and shows only that panel', () => {
    open();
    expect(tab('BUST').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('ADD DEBUG BUST')).toBeTruthy();
    expect(screen.queryByText('TRIGGER UNLOCK')).toBeNull();
  });

  it('switches panels without leaking the previous one', () => {
    open();
    fireEvent.click(tab('PROGRESS'));
    expect(screen.getByText('TRIGGER UNLOCK')).toBeTruthy();
    expect(screen.queryByText('ADD DEBUG BUST')).toBeNull();

    fireEvent.click(tab('SESSION'));
    expect(screen.getByText('CLEAR DEBUG SESSION')).toBeTruthy();
    expect(screen.queryByText('TRIGGER UNLOCK')).toBeNull();
  });

  it('renders the broadcast preview with the tokens filled in', () => {
    open();
    fireEvent.click(tab('NOTIFY'));
    expect(screen.getByText('AlexG has busted')).toBeTruthy();
  });

  it('flags a token it does not recognise instead of silently blanking it', () => {
    open();
    fireEvent.click(tab('NOTIFY'));
    fireEvent.change(screen.getByLabelText(/^Title$/i), { target: { value: 'hi {{NOPE}}' } });
    expect(screen.getByText(/Unrecognised/)).toBeTruthy();
  });

  /* The whole point of the confirm step: no push without a second click. */
  it('does not broadcast until the confirmation is accepted', () => {
    open();
    fireEvent.click(tab('NOTIFY'));
    fireEvent.click(screen.getByText('BROADCAST TO ALL USERS'));
    expect(broadcastTestNotification).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('CANCEL'));
    expect(broadcastTestNotification).not.toHaveBeenCalled();
  });

  it('broadcasts once the confirmation is accepted, and reports the result', async () => {
    open();
    fireEvent.click(tab('NOTIFY'));
    fireEvent.click(screen.getByText('BROADCAST TO ALL USERS'));
    fireEvent.click(screen.getByText('SEND IT'));

    expect(broadcastTestNotification).toHaveBeenCalledTimes(1);
    expect(broadcastTestNotification.mock.calls[0][0].title).toBe('{{USER}} has busted');
    expect(await screen.findByText(/Delivered to 3 of 3 devices/)).toBeTruthy();
  });

  it('surfaces a refusal from the server', async () => {
    broadcastTestNotification.mockRejectedValue(new Error('This account is not allowed to broadcast.'));
    open();
    fireEvent.click(tab('NOTIFY'));
    fireEvent.click(screen.getByText('BROADCAST TO ALL USERS'));
    fireEvent.click(screen.getByText('SEND IT'));
    expect(await screen.findByText('This account is not allowed to broadcast.')).toBeTruthy();
  });

  it('opens the lightbox from the tools tab and closes it again', () => {
    open();
    fireEvent.click(tab('TOOLS'));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByText('OPEN LIGHTBOX'));
    const lightbox = screen.getByRole('dialog');
    expect(lightbox.querySelector('img').getAttribute('src')).toBe('/bust-logo.png');

    fireEvent.click(screen.getByLabelText('Close image'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('browses achievements from the info button and inserts the picked id', async () => {
    open();
    fireEvent.click(tab('NOTIFY'));
    fireEvent.click(screen.getByLabelText('Browse every achievement'));

    // Every achievement is listed, each with its tier on the row.
    const rows = document.querySelectorAll('.ach-picker-row');
    expect(rows.length).toBe(achievements.length);
    expect(rows[0].className).toMatch(/tier-(bronze|silver|gold|platinum|mythic)/);

    fireEvent.change(screen.getByPlaceholderText(/Filter by name/), { target: { value: 'hat trick' } });
    const filtered = document.querySelectorAll('.ach-picker-row');
    expect(filtered.length).toBe(1);

    fireEvent.click(filtered[0]);
    expect(document.querySelector('.ach-picker')).toBeNull();
    expect(screen.getByLabelText(/^Body$/i).value).toContain('{{ACHIEVEMENT:hat_trick}}');
  });

  it('filters on id and tier too, and says so when nothing matches', () => {
    open();
    fireEvent.click(tab('NOTIFY'));
    fireEvent.click(screen.getByLabelText('Browse every achievement'));
    const filter = screen.getByPlaceholderText(/Filter by name/);

    fireEvent.change(filter, { target: { value: 'mythic' } });
    expect(document.querySelectorAll('.ach-picker-row').length).toBe(
      achievements.filter(a => a.tier === 'mythic').length
    );

    fireEvent.change(filter, { target: { value: 'zzzz-no-such-thing' } });
    expect(document.querySelectorAll('.ach-picker-row').length).toBe(0);
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
  });

  it('lists the crew alphabetically and needs both a user and a long password', () => {
    open();
    fireEvent.click(tab('ACCOUNTS'));
    const options = [...document.querySelectorAll('select option')].map(o => o.textContent);
    expect(options.slice(1)).toEqual(['Ann', 'Zoe']);

    const button = screen.getByText('FORCE PASSWORD RESET');
    expect(button.disabled).toBe(true);

    fireEvent.change(document.querySelector('select'), { target: { value: 'u-1' } });
    fireEvent.change(screen.getByLabelText(/New password/i), { target: { value: 'short' } });
    expect(screen.getByText(/at least 6 characters/i)).toBeTruthy();
    expect(button.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/New password/i), { target: { value: 'long-enough' } });
    expect(button.disabled).toBe(false);
  });

  /* Account takeover must never be one click away. */
  it('does not reset a password until the confirmation is accepted', () => {
    open();
    fireEvent.click(tab('ACCOUNTS'));
    fireEvent.change(document.querySelector('select'), { target: { value: 'u-1' } });
    fireEvent.change(screen.getByLabelText(/New password/i), { target: { value: 'long-enough' } });

    fireEvent.click(screen.getByText('FORCE PASSWORD RESET'));
    expect(adminSetPassword).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('CANCEL'));
    expect(adminSetPassword).not.toHaveBeenCalled();
  });

  it('resets on confirmation, reports it, and clears the field', async () => {
    open();
    fireEvent.click(tab('ACCOUNTS'));
    fireEvent.change(document.querySelector('select'), { target: { value: 'u-1' } });
    fireEvent.change(screen.getByLabelText(/New password/i), { target: { value: 'long-enough' } });
    fireEvent.click(screen.getByText('FORCE PASSWORD RESET'));
    fireEvent.click(screen.getByText('DO IT'));

    expect(adminSetPassword).toHaveBeenCalledWith({ userId: 'u-1', password: 'long-enough' });
    expect(await screen.findByText(/Password updated for Ann/)).toBeTruthy();
    expect(screen.getByLabelText(/New password/i).value).toBe('');
  });

  it('surfaces a refusal from the server', async () => {
    adminSetPassword.mockRejectedValue(new Error('This account is not allowed to perform admin actions.'));
    open();
    fireEvent.click(tab('ACCOUNTS'));
    fireEvent.change(document.querySelector('select'), { target: { value: 'u-1' } });
    fireEvent.change(screen.getByLabelText(/New password/i), { target: { value: 'long-enough' } });
    fireEvent.click(screen.getByText('FORCE PASSWORD RESET'));
    fireEvent.click(screen.getByText('DO IT'));
    expect(await screen.findByText(/not allowed to perform admin actions/)).toBeTruthy();
  });
});
