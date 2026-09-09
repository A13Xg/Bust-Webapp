import { describe, it, expect } from 'vitest';

import { BROADCAST_TOKENS, describeTokens, renderBroadcast, unknownTokens } from './broadcastTemplate.js';

const ctx = {
  recipient: 'Rex',
  sender: 'AlexG',
  crew: 4,
  sentAt: new Date('2026-09-08T17:30:00Z'),
  timeZone: 'UTC',
};

describe('broadcast templates', () => {
  it('fills the recipient and sender separately', () => {
    expect(renderBroadcast('{{USER}} has busted', ctx)).toBe('Rex has busted');
    expect(renderBroadcast('sent by {{SENDER}}', ctx)).toBe('sent by AlexG');
  });

  it('renders the same template differently per recipient', () => {
    const template = 'Wake up {{USER}}';
    expect(renderBroadcast(template, { ...ctx, recipient: 'Ann' })).toBe('Wake up Ann');
    expect(renderBroadcast(template, { ...ctx, recipient: 'Bo' })).toBe('Wake up Bo');
  });

  it('is case-insensitive and tolerates inner whitespace', () => {
    expect(renderBroadcast('{{user}} / {{ USER }} / {{UsEr}}', ctx)).toBe('Rex / Rex / Rex');
  });

  it('fills crew size, date and time', () => {
    expect(renderBroadcast('{{CREW}} on deck', ctx)).toBe('4 on deck');
    expect(renderBroadcast('{{DATE}}', ctx)).toBe('2026-09-08');
    expect(renderBroadcast('{{TIME}}', ctx)).toBe('17:30');
  });

  it('resolves an achievement id to its catalog name', () => {
    expect(renderBroadcast('{{ACHIEVEMENT:hat_trick}}', ctx)).toBe('Hat Trick');
  });

  it('leaves an unknown achievement id visible rather than blanking it', () => {
    expect(renderBroadcast('{{ACHIEVEMENT:not_real}}', ctx)).toBe('{{ACHIEVEMENT:not_real}}');
  });

  it('picks a reminder line from the catalog', () => {
    const out = renderBroadcast('{{REMINDER}}', ctx);
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toContain('{{');
  });

  /* Deliberately unlike notificationMessages' fill(), which blanks unknown
   * keys. An admin typing into a free-text box needs to SEE the typo. */
  it('leaves an unknown token literal so typos are visible', () => {
    expect(renderBroadcast('hello {{NOPE}}', ctx)).toBe('hello {{NOPE}}');
  });

  it('reports unknown tokens so the confirm dialog can warn', () => {
    expect(unknownTokens('{{USER}} {{NOPE}} {{ACHIEVEMENT:hat_trick}} {{ACHIEVEMENT:bad}}')).toEqual([
      '{{NOPE}}',
      '{{ACHIEVEMENT:bad}}',
    ]);
    expect(unknownTokens('{{USER}} plain text')).toEqual([]);
  });

  it('never leaves a recipient name blank', () => {
    expect(renderBroadcast('{{USER}}', { ...ctx, recipient: '' })).toBe('Someone');
    expect(renderBroadcast('{{USER}}', { ...ctx, recipient: null })).toBe('Someone');
  });

  it('handles an empty or missing template without throwing', () => {
    expect(renderBroadcast('', ctx)).toBe('');
    expect(renderBroadcast(undefined, ctx)).toBe('');
  });

  it('does not re-expand a token produced by a substitution', () => {
    expect(renderBroadcast('{{USER}}', { ...ctx, recipient: '{{SENDER}}' })).toBe('{{SENDER}}');
  });

  it('documents every token it supports', () => {
    const described = describeTokens().map(t => t.token);
    for (const token of Object.keys(BROADCAST_TOKENS)) {
      expect(described.some(d => d.includes(token))).toBe(true);
    }
    expect(describeTokens().every(t => t.hint.trim().length > 0)).toBe(true);
  });
});
