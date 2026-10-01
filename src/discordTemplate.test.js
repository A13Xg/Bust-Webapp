import { describe, it, expect } from 'vitest';

import {
  DISCORD_TOKENS,
  badgeImageUrl,
  buildAchievementDiscordPayload,
  buildBustDiscordPayload,
  describeDiscordTokens,
  hexToDiscordColor,
  renderDiscordTemplate,
  unknownDiscordTokens,
} from './discordTemplate.js';

const ctx = {
  username: 'AlexG',
  note: 'Record pressure event',
  city: 'Austin',
  sentAt: new Date('2026-09-08T17:30:00Z'),
  timeZone: 'UTC',
  achievementName: 'Hat Trick',
  tier: 'silver',
  points: 30,
  pushTitle: 'AlexG just busted',
  pushBody: 'Cooldown started.',
  accent: '#f5f0e8',
  siteUrl: 'https://a13xg.github.io/Bust-Webapp',
};

describe('discord templates', () => {
  it('fills user, note, city', () => {
    expect(renderDiscordTemplate('{{USER}} in {{CITY}}: {{NOTE}}', ctx)).toBe('AlexG in Austin: Record pressure event');
  });

  it('falls back to the push copy by default', () => {
    expect(renderDiscordTemplate('{{PUSH_TITLE}} / {{PUSH_BODY}}', ctx)).toBe('AlexG just busted / Cooldown started.');
  });

  it('title-cases the tier and stringifies points', () => {
    expect(renderDiscordTemplate('{{TIER}} +{{POINTS}}', ctx)).toBe('Silver +30');
  });

  it('fills date and time', () => {
    expect(renderDiscordTemplate('{{DATE}} {{TIME}}', ctx)).toBe('2026-09-08 17:30');
  });

  it('never leaves the user blank', () => {
    expect(renderDiscordTemplate('{{USER}}', { ...ctx, username: '' })).toBe('Someone');
  });

  it('leaves an unknown token literal so a typo is visible', () => {
    expect(renderDiscordTemplate('hello {{NOPE}}', ctx)).toBe('hello {{NOPE}}');
  });

  it('reports unknown tokens', () => {
    expect(unknownDiscordTokens('{{USER}} {{NOPE}}')).toEqual(['{{NOPE}}']);
    expect(unknownDiscordTokens('{{USER}} {{ACHIEVEMENT}}')).toEqual([]);
  });

  it('documents every token it supports', () => {
    const described = describeDiscordTokens().map(t => t.token);
    for (const token of Object.keys(DISCORD_TOKENS)) {
      expect(described.some(d => d.includes(token))).toBe(true);
    }
  });

  it('converts a hex color to the Discord integer form', () => {
    expect(hexToDiscordColor('#5865F2')).toBe(0x5865f2);
    expect(hexToDiscordColor('5865F2')).toBe(0x5865f2);
    expect(hexToDiscordColor('not-a-color')).toBeNull();
    expect(hexToDiscordColor(null)).toBeNull();
  });

  it('builds an absolute badge sprite URL per tier', () => {
    expect(badgeImageUrl('gold', 'https://example.com/app/')).toBe('https://example.com/app/badges/512/gold.png');
    expect(badgeImageUrl(null, '')).toBeNull();
  });

  it('builds a bust payload with the default blurple color', () => {
    const payload = buildBustDiscordPayload(ctx, {});
    expect(payload.embeds[0].title).toBe('💥 AlexG just busted');
    expect(payload.embeds[0].description).toBe('Cooldown started.');
    expect(payload.embeds[0].color).toBe(0x5865f2);
    expect(payload.embeds[0].fields).toEqual([{ name: 'City', value: 'Austin', inline: true }]);
    expect(payload.embeds[0].thumbnail).toBeUndefined();
    expect(payload.username).toBe('BUST Control');
  });

  it('builds an achievement payload with tier/points fields and a badge thumbnail', () => {
    const payload = buildAchievementDiscordPayload(ctx, {});
    expect(payload.embeds[0].title).toBe('🏆 AlexG just busted');
    expect(payload.embeds[0].fields).toEqual([
      { name: 'Tier', value: 'Silver', inline: true },
      { name: 'Points', value: '30', inline: true },
    ]);
    expect(payload.embeds[0].thumbnail.url).toBe('https://a13xg.github.io/Bust-Webapp/badges/512/silver.png');
    // No explicit achievement_color/bust_color configured: falls back to the
    // achievement's own catalog accent rather than the flat default.
    expect(payload.embeds[0].color).toBe(hexToDiscordColor(ctx.accent));
  });

  it('honours admin overrides: custom templates, color, username, avatar, mention, no thumbnail', () => {
    const settings = {
      bust_title_template: '{{USER}} went off in {{CITY}}',
      bust_description_template: 'Note: {{NOTE}}',
      bust_color: '#00FF00',
      bot_username: 'Pressure Bot',
      bot_avatar_url: 'https://example.com/avatar.png',
      mention_content: '@everyone',
      footer_text: 'Crew Ops',
    };
    const payload = buildBustDiscordPayload(ctx, settings);
    expect(payload.embeds[0].title).toBe('AlexG went off in Austin');
    expect(payload.embeds[0].description).toBe('Note: Record pressure event');
    expect(payload.embeds[0].color).toBe(0x00ff00);
    expect(payload.embeds[0].footer.text).toBe('Crew Ops');
    expect(payload.username).toBe('Pressure Bot');
    expect(payload.avatar_url).toBe('https://example.com/avatar.png');
    expect(payload.content).toBe('@everyone');

    const achievementPayload = buildAchievementDiscordPayload(ctx, { include_thumbnail: false });
    expect(achievementPayload.embeds[0].thumbnail).toBeUndefined();
  });
});
