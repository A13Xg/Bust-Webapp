/*
 * Expansion achievement & badge catalog (see ACHIEVEMENTS_PLAN.md).
 * Every item: { id, name, desc, tier, kind, category, micon (Material Symbol), points, check(ctx) }
 * ctx = { own, all, others, unlockedIds, opts:{ createdAt, userCount } }
 */
import { todayKey, achievements, COOLDOWN_MS } from './rules.js';

const MS_DAY = 86400000;
const D = t => new Date(t);
const hh = b => D(b.timestamp).getHours();
const mm = b => D(b.timestamp).getMinutes();
const md = b => `${D(b.timestamp).getMonth() + 1}-${D(b.timestamp).getDate()}`;
const monthKey = b => D(b.timestamp).getFullYear() * 12 + D(b.timestamp).getMonth();
const quarterKey = b => D(b.timestamp).getFullYear() * 4 + Math.floor(D(b.timestamp).getMonth() / 3);
const dayStamp = b => { const d = D(b.timestamp); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
const notes = own => own.map(b => String(b.note || '')).filter(n => n.trim().length);
const count = (arr, fn) => arr.filter(fn).length;
const distinct = (arr, fn) => new Set(arr.map(fn).filter(v => v != null && v !== '')).size;
const cities = own => own.map(b => (b.city || '').trim()).filter(Boolean);

const HOLIDAYS = ['1-1', '2-14', '3-17', '7-4', '10-31', '12-25', '12-31'];
const SOLSTICE = ['3-19', '3-20', '3-21', '6-19', '6-20', '6-21', '6-22', '9-21', '9-22', '9-23', '9-24', '12-20', '12-21', '12-22', '12-23'];

function haversineMiles(a, b) {
  const R = 3958.8, toR = x => x * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLon = toR(b.long - a.long);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function legs(own) {
  const pts = own.filter(b => b.lat != null && b.long != null);
  const out = [];
  for (let i = 1; i < pts.length; i++) out.push(haversineMiles(pts[i - 1], pts[i]));
  return out;
}
const palindrome = b => { const s = `${hh(b)}`.padStart(2, '0') + `${mm(b)}`.padStart(2, '0'); return s === [...s].reverse().join(''); };
const nearExpiry = (own, windowMs) => { let n = 0; for (let i = 1; i < own.length; i++) { const gap = D(own[i].timestamp) - D(own[i - 1].timestamp); if (gap >= COOLDOWN_MS && gap <= COOLDOWN_MS + windowMs) n++; } return n; };
const atMinuteZero = own => count(own, b => mm(b) === 0);
const hourCounts = own => { const h = Array(24).fill(0); own.forEach(b => h[hh(b)]++); return Math.max(0, ...h); };
const gaps14 = own => { let n = 0; for (let i = 1; i < own.length; i++) if (D(own[i].timestamp) - D(own[i - 1].timestamp) >= 14 * MS_DAY) n++; return n; };
const anniversaryHits = (own, createdAt) => { if (!createdAt) return 0; const c = D(createdAt); const key = `${c.getMonth() + 1}-${c.getDate()}`; const years = new Set(own.filter(b => md(b) === key && D(b.timestamp).getFullYear() > c.getFullYear()).map(b => D(b.timestamp).getFullYear())); return years.size; };
function businessWeeks(own) {
  const stamps = new Set(own.map(dayStamp));
  const weeks = new Set();
  for (const s of stamps) { const d = new Date(s); if (d.getDay() === 1) { let ok = true; for (let i = 1; i < 5; i++) if (!stamps.has(s + i * MS_DAY)) { ok = false; break; } if (ok) weeks.add(s); } }
  return weeks.size;
}
function consecutiveMonths(own, need) { const ks = [...new Set(own.map(monthKey))].sort((a, b) => a - b); let run = 1; for (let i = 1; i < ks.length; i++) { run = ks[i] - ks[i - 1] === 1 ? run + 1 : 1; if (run >= need) return true; } return ks.length >= need && need === 1; }
function consecutiveQuarters(own, need) { const ks = [...new Set(own.map(quarterKey))].sort((a, b) => a - b); let run = 1; for (let i = 1; i < ks.length; i++) { run = ks[i] - ks[i - 1] === 1 ? run + 1 : 1; if (run >= need) return true; } return false; }
function perfectMonth(own) { const byMonth = {}; own.forEach(b => { const d = D(b.timestamp); const k = `${d.getFullYear()}-${d.getMonth()}`; (byMonth[k] = byMonth[k] || new Set()).add(d.getDate()); }); return Object.entries(byMonth).some(([k, days]) => { const [y, m] = k.split('-').map(Number); return days.size >= new Date(y, m + 1, 0).getDate(); }); }
const daysWithTwo = own => { const c = {}; own.forEach(b => { const k = todayKey(b.timestamp); c[k] = (c[k] || 0) + 1; }); return Object.values(c).filter(n => n >= 2).length; };
const pressureBand = p => { p = Number(p); if (!Number.isFinite(p)) return null; if (p < 990) return 0; if (p < 1005) return 1; if (p < 1015) return 2; if (p < 1025) return 3; return 4; };
const tempBand = t => { t = Number(t); if (!Number.isFinite(t)) return null; if (t < 32) return 0; if (t < 52) return 1; if (t < 72) return 2; if (t < 92) return 3; return 4; };
const elevation = b => { const e = Number(b.elevation_ft); return Number.isFinite(e) ? e : null; };
const elevationBand = b => { const e = elevation(b); if (e == null) return null; if (e < 100) return 0; if (e < 1000) return 1; if (e < 5280) return 2; if (e < 8000) return 3; return 4; };
const tideSign = b => { const t = Number(b.tide_ft); return Number.isFinite(t) ? (t >= 0 ? 1 : -1) : null; };
const homeCityMax = own => { const c = {}; cities(own).forEach(x => c[x] = (c[x] || 0) + 1); return Math.max(0, ...Object.values(c)); };
function citiesInWeek(own, need) { const pts = own.filter(b => b.city); for (let i = 0; i < pts.length; i++) { const set = new Set(); for (let j = i; j < pts.length; j++) { if (D(pts[j].timestamp) - D(pts[i].timestamp) > 7 * MS_DAY) break; set.add(pts[j].city.trim()); } if (set.size >= need) return true; } return false; }
const EMOJI = /\p{Extended_Pictographic}/u;
const emojiOnly = n => { const s = n.replace(/\s+/g, ''); if (!s) return false; const chars = [...s]; return chars.filter(c => EMOJI.test(c)).length >= 3 && chars.every(c => EMOJI.test(c) || /[‍️⃣]/.test(c)); };
const distinctEmoji = own => { const set = new Set(); notes(own).forEach(n => { for (const ch of n) if (EMOJI.test(ch)) set.add(ch); }); return set.size; };
const oneWord = n => n.trim().length > 0 && !/\s/.test(n.trim());
const threeLines = n => n.split('\n').map(l => l.trim()).filter(Boolean).length === 3;
const ARCHAIC = /\b(thee|thou|thy)\b/i;
// social helpers (use full feed, sorted asc)
const within = (a, b, ms) => Math.abs(D(a.timestamp) - D(b.timestamp)) <= ms;
const respondedTo = (own, others, ms) => count(own, b => others.some(o => D(b.timestamp) - D(o.timestamp) > 0 && D(b.timestamp) - D(o.timestamp) <= ms));
const chainThird = (own, all) => count(own, b => new Set(all.filter(o => o.user_id !== b.user_id && D(b.timestamp) - D(o.timestamp) > 0 && D(b.timestamp) - D(o.timestamp) <= 3600000).map(o => o.user_id)).size >= 2);
const chainLeader = (own, all) => count(own, b => new Set(all.filter(o => o.user_id !== b.user_id && D(o.timestamp) - D(b.timestamp) > 0 && D(o.timestamp) - D(b.timestamp) <= 3600000).map(o => o.user_id)).size >= 2);
const synced = (own, others) => count(own, b => others.some(o => within(b, o, 60000)));
const firstOfDay = (own, all) => count(own, b => { const k = todayKey(b.timestamp); const first = all.filter(x => todayKey(x.timestamp) === k).sort((a, c) => D(a.timestamp) - D(c.timestamp))[0]; return first && first.id === b.id; });

function item(id, name, desc, tier, kind, category, micon, points, check) {
  return { id, name, desc, tier, kind, category, micon, points, check, track: 'expansion', icon: 'Shield', accent: { bronze: '#cd7f32', silver: '#c9ccd3', gold: '#ffd166', platinum: '#9be8f0', mythic: '#c77dff' }[tier], goal: 1 };
}

export const expansionCatalog = [
  // ---- Timing & Precision — achievements
  item('on_the_dot', 'On the Dot', 'Bust at exactly :00 of any hour.', 'silver', 'achievement', 'Timing & Precision', 'schedule', 30, c => atMinuteZero(c.own) >= 1),
  item('palindrome_pressure', 'Palindrome Pressure', 'Bust at a palindrome time (12:21, 15:51…).', 'silver', 'achievement', 'Timing & Precision', 'swap_horiz', 35, c => c.own.some(palindrome)),
  item('photo_finish', 'Photo Finish', 'Bust within 60 seconds of the cooldown expiring.', 'gold', 'achievement', 'Timing & Precision', 'timer', 50, c => nearExpiry(c.own, 60000) >= 1),
  item('midnight_strike', 'Midnight Strike', 'Bust in the first five minutes of a new day.', 'gold', 'achievement', 'Timing & Precision', 'bedtime', 45, c => c.own.some(b => hh(b) === 0 && mm(b) < 5)),
  item('high_noon_ace', 'High Noon', 'Bust between 12:00 and 12:04 PM.', 'silver', 'achievement', 'Timing & Precision', 'wb_sunny', 30, c => c.own.some(b => hh(b) === 12 && mm(b) < 5)),
  item('leap_of_faith', 'Leap of Faith', 'Bust on February 29th.', 'mythic', 'achievement', 'Timing & Precision', 'event_repeat', 150, c => c.own.some(b => md(b) === '2-29')),
  item('new_year_new_me', 'New Year, New Me', 'Bust on January 1st.', 'gold', 'achievement', 'Timing & Precision', 'celebration', 60, c => c.own.some(b => md(b) === '1-1')),
  item('spooky_splash', 'Spooky Splash', 'Bust on October 31st.', 'silver', 'achievement', 'Timing & Precision', 'nightlight', 40, c => c.own.some(b => md(b) === '10-31')),
  item('solstice_ritual', 'Solstice Ritual', 'Bust on a solstice or equinox (±1 day).', 'gold', 'achievement', 'Timing & Precision', 'brightness_4', 55, c => c.own.some(b => SOLSTICE.includes(md(b)))),
  item('birthday_suit', 'Birthday Suit', 'Bust on your account-creation anniversary.', 'gold', 'achievement', 'Timing & Precision', 'cake', 60, c => anniversaryHits(c.own, c.opts.createdAt) >= 1),
  // ---- Timing & Precision — badges
  item('minute_hand', 'Minute Hand', '5 busts at exactly :00.', 'gold', 'badge', 'Timing & Precision', 'history_toggle_off', 90, c => atMinuteZero(c.own) >= 5),
  item('second_hand', 'Second Hand', '15 busts at exactly :00.', 'platinum', 'badge', 'Timing & Precision', 'more_time', 180, c => atMinuteZero(c.own) >= 15),
  item('buzzer_beater', 'Buzzer Beater', '5 busts within 5 minutes of cooldown expiry.', 'gold', 'badge', 'Timing & Precision', 'sports_score', 95, c => nearExpiry(c.own, 300000) >= 5),
  item('cooldown_surgeon', 'Cooldown Surgeon', '15 busts within 5 minutes of cooldown expiry.', 'mythic', 'badge', 'Timing & Precision', 'medical_services', 240, c => nearExpiry(c.own, 300000) >= 15),
  item('calendar_collector', 'Calendar Collector', 'Bust on 5 distinct holidays.', 'platinum', 'badge', 'Timing & Precision', 'event_available', 160, c => distinct(c.own.filter(b => HOLIDAYS.includes(md(b))), md) >= 5),
  item('anniversary_chain', 'Anniversary Chain', 'Bust on 3 separate account anniversaries.', 'mythic', 'badge', 'Timing & Precision', 'redeem', 300, c => anniversaryHits(c.own, c.opts.createdAt) >= 3),

  // ---- Squad Play — achievements
  item('first_responder', 'First Responder', 'Bust within 10 minutes of a crewmate.', 'silver', 'achievement', 'Squad Play', 'e911_emergency', 35, c => respondedTo(c.own, c.others, 600000) >= 1),
  item('chain_reaction', 'Chain Reaction', 'Be the 3rd crew member to bust within one hour.', 'gold', 'achievement', 'Squad Play', 'link', 55, c => chainThird(c.own, c.all) >= 1),
  item('synchronized_swimmers', 'Synchronized Swimmers', 'Bust within 60 seconds of a crewmate.', 'gold', 'achievement', 'Squad Play', 'sync', 60, c => synced(c.own, c.others) >= 1),
  item('lone_wolf', 'Lone Wolf', 'Only member to bust in 48 hours (3+ member crew).', 'silver', 'achievement', 'Squad Play', 'raven', 40, c => (c.opts.userCount || 0) >= 3 && c.own.some(b => !c.others.some(o => D(b.timestamp) - D(o.timestamp) > 0 && D(b.timestamp) - D(o.timestamp) <= 48 * 3600000))),
  item('pace_setter', 'Pace Setter', "Log the group's first bust of the day, 5 times.", 'silver', 'achievement', 'Squad Play', 'flag', 45, c => firstOfDay(c.own, c.all) >= 5),
  // ---- Squad Play — badges
  item('wingman', 'Wingman', '10 busts within 10 minutes of a crewmate.', 'gold', 'badge', 'Squad Play', 'group', 100, c => respondedTo(c.own, c.others, 600000) >= 10),
  item('squadron_leader', 'Squadron Leader', 'Start 5 chains that 2+ crewmates join within an hour.', 'platinum', 'badge', 'Squad Play', 'groups', 170, c => chainLeader(c.own, c.all) >= 5),
  item('twin_turbines', 'Twin Turbines', '5 synchronized (within 60s) events.', 'platinum', 'badge', 'Squad Play', 'cyclone', 175, c => synced(c.own, c.others) >= 5),
  item('opening_ceremony', 'Opening Ceremony', 'First group bust of the day, 25 times.', 'platinum', 'badge', 'Squad Play', 'campaign', 190, c => firstOfDay(c.own, c.all) >= 25),

  // ---- Calendar — achievements
  item('business_hours', 'Business Hours', 'Bust on 5 consecutive weekdays (Mon–Fri).', 'gold', 'achievement', 'Calendar', 'work', 65, c => businessWeeks(c.own) >= 1),
  item('full_rotation', 'Full Rotation', 'Bust on all 7 days of the week (lifetime).', 'gold', 'achievement', 'Calendar', 'view_week', 60, c => distinct(c.own, b => D(b.timestamp).getDay()) >= 7),
  item('monthly_subscriber', 'Monthly Subscriber', 'Bust in 3 consecutive calendar months.', 'gold', 'achievement', 'Calendar', 'calendar_month', 70, c => consecutiveMonths(c.own, 3)),
  item('quarterly_report', 'Quarterly Report', 'Bust in 4 consecutive quarters.', 'platinum', 'achievement', 'Calendar', 'monitoring', 110, c => consecutiveQuarters(c.own, 4)),
  item('dry_spell_broken', 'Dry Spell Broken', 'Bust after 14+ days of personal inactivity.', 'bronze', 'achievement', 'Calendar', 'water_drop', 20, c => gaps14(c.own) >= 1),
  item('clockwork', 'Clockwork', 'Bust in the same hour-of-day 5 times.', 'silver', 'achievement', 'Calendar', 'avg_pace', 40, c => hourCounts(c.own) >= 5),
  // ---- Calendar — badges
  item('payroll_regular', 'Payroll Regular', '4 separate Mon–Fri full weeks.', 'platinum', 'badge', 'Calendar', 'badge', 150, c => businessWeeks(c.own) >= 4),
  item('perfect_month', 'Perfect Month', 'Bust every day of one calendar month.', 'mythic', 'badge', 'Calendar', 'auto_awesome', 400, c => perfectMonth(c.own)),
  item('season_ticket', 'Season Ticket', 'Bust in 12 consecutive months.', 'mythic', 'badge', 'Calendar', 'loyalty', 350, c => consecutiveMonths(c.own, 12)),
  item('metronome', 'Metronome', '15 busts in your most-repeated hour.', 'gold', 'badge', 'Calendar', 'graphic_eq', 110, c => hourCounts(c.own) >= 15),
  item('phoenix', 'Phoenix', 'Break 3 separate 14-day dry spells.', 'silver', 'badge', 'Calendar', 'local_fire_department', 80, c => gaps14(c.own) >= 3),
  item('daily_double_decade', 'Daily Double Decade', '10 days with 2+ busts.', 'platinum', 'badge', 'Calendar', 'looks_two', 165, c => daysWithTwo(c.own) >= 10),

  // ---- Expedition — achievements
  item('storm_chaser', 'Storm Chaser', 'Bust while pressure is Very Low (<990 hPa).', 'gold', 'achievement', 'Expedition', 'storm', 55, c => c.own.some(b => pressureBand(b.pressure) === 0)),
  item('perfect_conditions', 'Perfect Conditions', 'Bust at 68–72°F with Medium pressure.', 'silver', 'achievement', 'Expedition', 'thermostat', 40, c => c.own.some(b => Number(b.temp_f) >= 68 && Number(b.temp_f) <= 72 && pressureBand(b.pressure) === 2)),
  item('traveler', 'Traveler', 'Bust from 2 different cities.', 'silver', 'achievement', 'Expedition', 'luggage', 40, c => new Set(cities(c.own)).size >= 2),
  item('jet_setter', 'Jet Setter', 'Bust from 5 different cities.', 'platinum', 'achievement', 'Expedition', 'flight_takeoff', 100, c => new Set(cities(c.own)).size >= 5),
  item('border_runner', 'Border Runner', 'Bust 100+ miles from your previous bust.', 'gold', 'achievement', 'Expedition', 'route', 65, c => legs(c.own).some(m => m >= 100)),
  item('home_base', 'Home Base', '10 busts from the same city.', 'silver', 'achievement', 'Expedition', 'home', 45, c => homeCityMax(c.own) >= 10),
  item('freezing_point', 'Freezing Point', 'Bust at exactly 32°F (±0.5°).', 'gold', 'achievement', 'Expedition', 'ac_unit', 60, c => c.own.some(b => Math.abs(Number(b.temp_f) - 32) <= 0.5)),
  item('sea_level_scout', 'Sea-Level Scout', 'Bust below 100ft ASL.', 'bronze', 'achievement', 'Expedition', 'waves', 25, c => c.own.some(b => elevation(b) != null && elevation(b) < 100)),
  item('thin_air', 'Thin Air', 'Bust above 5,280ft ASL.', 'gold', 'achievement', 'Expedition', 'landscape_2', 70, c => c.own.some(b => elevation(b) >= 5280)),
  item('cloudline_climber', 'Cloudline Climber', 'Bust above 8,000ft ASL.', 'platinum', 'achievement', 'Expedition', 'filter_hdr', 115, c => c.own.some(b => elevation(b) >= 8000)),
  item('low_tide_logger', 'Low Tide Logger', 'Bust during a Low Tide.', 'bronze', 'achievement', 'Expedition', 'water', 20, c => c.own.some(b => tideSign(b) === -1)),
  item('high_tide_hero', 'High Tide Hero', 'Bust during a High Tide.', 'bronze', 'achievement', 'Expedition', 'tsunami', 20, c => c.own.some(b => tideSign(b) === 1)),
  item('tidal_duality', 'Tidal Duality', 'Bust during both a High and a Low Tide (lifetime).', 'silver', 'achievement', 'Expedition', 'sailing', 35, c => { const s = new Set(c.own.map(tideSign).filter(v => v != null)); return s.has(1) && s.has(-1); }),
  // ---- Expedition — badges
  item('weather_vane', 'Weather Vane', 'Bust in all five pressure bands.', 'platinum', 'badge', 'Expedition', 'air', 180, c => new Set(c.own.map(b => pressureBand(b.pressure)).filter(v => v != null)).size >= 5),
  item('thermometer_breaker', 'Thermometer Breaker', 'Bust in all five temperature bands.', 'platinum', 'badge', 'Expedition', 'device_thermostat', 185, c => new Set(c.own.map(b => tempBand(b.temp_f)).filter(v => v != null)).size >= 5),
  item('storm_rider', 'Storm Rider', '5 busts in Very Low pressure.', 'platinum', 'badge', 'Expedition', 'thunderstorm', 160, c => count(c.own, b => pressureBand(b.pressure) === 0) >= 5),
  item('climate_diplomat', 'Climate Diplomat', '3 different cities in one week.', 'mythic', 'badge', 'Expedition', 'public', 260, c => citiesInWeek(c.own, 3)),
  item('odometer', 'Odometer', '500 cumulative miles between bust locations.', 'platinum', 'badge', 'Expedition', 'speed', 170, c => legs(c.own).reduce((s, m) => s + m, 0) >= 500),
  item('landmark_legend', 'Landmark Legend', '25 busts from your home city.', 'gold', 'badge', 'Expedition', 'location_city', 120, c => homeCityMax(c.own) >= 25),
  item('mile_high_club', 'Mile-High Club', '5 busts above 5,280ft ASL.', 'platinum', 'badge', 'Expedition', 'altitude', 170, c => count(c.own, b => elevation(b) >= 5280) >= 5),
  item('altitude_sampler', 'Altitude Sampler', 'Bust in 3 elevation bands.', 'gold', 'badge', 'Expedition', 'terrain', 120, c => new Set(c.own.map(elevationBand).filter(v => v != null)).size >= 3),
  item('summit_circuit', 'Summit Circuit', '10 busts above 8,000ft ASL.', 'mythic', 'badge', 'Expedition', 'hiking', 280, c => count(c.own, b => elevation(b) >= 8000) >= 10),
  item('low_tide_regular', 'Low Tide Regular', '10 busts during a Low Tide.', 'gold', 'badge', 'Expedition', 'anchor', 100, c => count(c.own, b => tideSign(b) === -1) >= 10),
  item('high_tide_devotee', 'High Tide Devotee', '10 busts during a High Tide.', 'gold', 'badge', 'Expedition', 'beach_access', 100, c => count(c.own, b => tideSign(b) === 1) >= 10),
  item('tide_master', 'Tide Master', '10 busts during Low Tide and 10 during High Tide.', 'platinum', 'badge', 'Expedition', 'waves', 170, c => count(c.own, b => tideSign(b) === -1) >= 10 && count(c.own, b => tideSign(b) === 1) >= 10),

  // ---- Wordsmith — achievements
  item('emoji_artist', 'Emoji Artist', 'A note made only of emoji (3+).', 'bronze', 'achievement', 'Wordsmith', 'mood', 20, c => notes(c.own).some(emojiOnly)),
  item('haiku_master', 'Haiku Master', 'A three-line haiku note.', 'gold', 'achievement', 'Wordsmith', 'spa', 55, c => notes(c.own).some(threeLines)),
  item('novelist', 'Novelist', 'Fill the entire 240-character note limit.', 'silver', 'achievement', 'Wordsmith', 'menu_book', 35, c => notes(c.own).some(n => n.length >= 240)),
  item('man_of_few_words', 'Man of Few Words', 'One-word notes, 5 times.', 'bronze', 'achievement', 'Wordsmith', 'short_text', 25, c => count(notes(c.own), oneWord) >= 5),
  item('shakespeare', 'Shakespeare', 'Use "thee", "thou", or "thy" in a note.', 'bronze', 'achievement', 'Wordsmith', 'history_edu', 20, c => notes(c.own).some(n => ARCHAIC.test(n))),
  // ---- Wordsmith — badges
  item('emoji_dictionary', 'Emoji Dictionary', '25 distinct emoji across all notes.', 'gold', 'badge', 'Wordsmith', 'emoji_emotions', 100, c => distinctEmoji(c.own) >= 25),
  item('poet_laureate', 'Poet Laureate', '5 haiku notes.', 'platinum', 'badge', 'Wordsmith', 'format_quote', 150, c => count(notes(c.own), threeLines) >= 5),
  item('full_manuscript', 'Full Manuscript', '5 max-length notes.', 'gold', 'badge', 'Wordsmith', 'auto_stories', 105, c => count(notes(c.own), n => n.length >= 240) >= 5),
  item('minimalist_monk', 'Minimalist Monk', '25 one-word notes.', 'gold', 'badge', 'Wordsmith', 'self_improvement', 95, c => count(notes(c.own), oneWord) >= 25),
  item('bard_of_the_bay', 'Bard of the Bay', '10 notes with archaic English.', 'silver', 'badge', 'Wordsmith', 'theater_comedy', 85, c => count(notes(c.own), n => ARCHAIC.test(n)) >= 10),
];

// ---- Meta badges (evaluated after everything else)
export const metaCatalog = [
  item('completionist_i', 'Completionist I', 'Unlock 25 total achievements & badges.', 'gold', 'badge', 'Meta', 'task_alt', 120, c => c.totalUnlocked >= 25),
  item('completionist_ii', 'Completionist II', 'Unlock 50 total achievements & badges.', 'platinum', 'badge', 'Meta', 'checklist', 220, c => c.totalUnlocked >= 50),
  item('completionist_iii', 'Completionist III', 'Unlock everything else.', 'mythic', 'badge', 'Meta', 'crown', 1000, c => c.totalUnlocked >= c.catalogSize - 1),
  item('xp_tycoon', 'XP Tycoon', 'Reach 2,000 lifetime XP.', 'platinum', 'badge', 'Meta', 'paid', 200, c => c.totalXp >= 2000),
  item('the_collector', 'The Collector', 'Own a badge from every expansion category.', 'platinum', 'badge', 'Meta', 'category', 190, c => ['Timing & Precision', 'Squad Play', 'Calendar', 'Expedition', 'Wordsmith'].every(cat => expansionCatalog.some(i => i.kind === 'badge' && i.category === cat && c.unlockedIds.has(i.id)))),
];

export const expansionItems = [...expansionCatalog, ...metaCatalog];
export const expansionCategories = ['Timing & Precision', 'Squad Play', 'Calendar', 'Expedition', 'Wordsmith', 'Meta'];

export function computeExpansionUnlocks(userId, busts, existing = [], opts = {}) {
  const all = [...busts].filter(Boolean).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const own = all.filter(b => b.user_id === userId);
  if (!own.length) return [];
  const others = all.filter(b => b.user_id !== userId);
  const unlockedIds = new Set(existing.filter(a => a.user_id === userId).map(a => a.achievement_type));
  const ctx = { own, all, others, unlockedIds, opts };
  const fresh = [];
  for (const it of expansionCatalog) {
    if (unlockedIds.has(it.id)) continue;
    try { if (it.check(ctx)) { fresh.push(it.id); unlockedIds.add(it.id); } } catch { /* never block a bust on a bad check */ }
  }
  // meta pass — counts include everything unlocked so far (legacy + tracks + expansion + this round)
  const totalUnlocked = unlockedIds.size;
  const totalXp = [...unlockedIds].map(id => achievements.find(x => x.id === id)?.points || 0).reduce((s, p) => s + p, 0);
  const metaCtx = { ...ctx, totalUnlocked, totalXp, catalogSize: achievements.length };
  for (const it of metaCatalog) {
    if (metaCtx.unlockedIds.has(it.id)) continue;
    try { if (it.check(metaCtx)) fresh.push(it.id); } catch {}
  }
  return fresh;
}
