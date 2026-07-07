# BUST — Achievement & Badge Expansion Plan

Everything below is **new** — checked against the implemented catalog (the 11 legacy items and the 10 three-stage tracks: Scorcher Circuit, Daypart Dominion, Volume Marathon, Weekend Warrior, Pressure System, Cold Front, Field Notes, Cartography, Weekly Streak, Night Shift). No names or conditions overlap.

Data available for conditions: timestamp, time bucket, note text, temp °F, pressure hPa, lat/long, city, per-user history, group feed, achievements/XP.

---

## Part 1 — Achievements (single unlock conditions)

### Timing & Precision
| Achievement | Requirement | Tier | XP |
|---|---|---|---|
| On the Dot | Bust at exactly :00 of any hour | silver | 30 |
| Palindrome Pressure | Bust at a palindrome time (e.g. 12:21, 15:51) | silver | 35 |
| Photo Finish | Bust within 60 seconds of the cooldown expiring | gold | 50 |
| Midnight Strike | Bust between 12:00:00 AM and 12:04:59 AM | gold | 45 |
| High Noon | Bust between 12:00 PM and 12:04 PM | silver | 30 |
| Leap of Faith | Bust on February 29th | mythic | 150 |
| New Year, New Me | Bust on January 1st | gold | 60 |
| Spooky Splash | Bust on October 31st | silver | 40 |
| Solstice Ritual | Bust on a solstice or equinox (±1 day) | gold | 55 |
| Birthday Suit | Bust on your account-creation anniversary | gold | 60 |

### Social & Group Play
| Achievement | Requirement | Tier | XP |
|---|---|---|---|
| First Responder | Bust within 10 minutes of a crewmate's bust | silver | 35 |
| Chain Reaction | Be the 3rd crew member to bust within one hour | gold | 55 |
| Synchronized Swimmers | Two crew members bust within 60 seconds of each other | gold | 60 |
| Lone Wolf | Be the only member to bust in a 48-hour window (min. 3 active users) | silver | 40 |
| Pace Setter | Log the first bust of a calendar day for the group, 5 times | silver | 45 |
| Underdog Story | Go from last place to top-3 on the all-time leaderboard | platinum | 90 |

### Consistency & Calendar
| Achievement | Requirement | Tier | XP |
|---|---|---|---|
| Business Hours | Bust on 5 consecutive weekdays (Mon–Fri) | gold | 65 |
| Full Rotation | Bust on all 7 days of the week (lifetime coverage) | gold | 60 |
| Monthly Subscriber | Bust at least once in each of 3 consecutive calendar months | gold | 70 |
| Quarterly Report | Bust in 4 consecutive calendar quarters | platinum | 110 |
| Dry Spell Broken | Bust after 14+ days of personal inactivity | bronze | 20 |
| Clockwork | Bust in the same hour-of-day 5 times | silver | 40 |

### Environment & Location
| Achievement | Requirement | Tier | XP |
|---|---|---|---|
| Storm Chaser | Bust while pressure reads Very Low (<990 hPa) | gold | 55 |
| Perfect Conditions | Bust between 68–72°F with Medium pressure | silver | 40 |
| Traveler | Bust from 2 different cities | silver | 40 |
| Jet Setter | Bust from 5 different cities | platinum | 100 |
| Border Runner | Bust from 100+ miles away from your previous bust | gold | 65 |
| Home Base | 10 busts from the same city | silver | 45 |
| Freezing Point | Bust at exactly 32°F (±0.5°) | gold | 60 |

### Notes & Flair
| Achievement | Requirement | Tier | XP |
|---|---|---|---|
| Emoji Artist | Note consisting only of emoji (3+) | bronze | 20 |
| Haiku Master | Note with exactly a 5-7-5 syllable structure (honor system: 3 lines) | gold | 55 |
| Novelist | Note using the full 240-character limit | silver | 35 |
| Man of Few Words | Note of exactly one word, 5 times | bronze | 25 |
| Shakespeare | Include "thee", "thou", or "thy" in a note | bronze | 20 |

---

## Part 2 — Badges (larger paired set; counted/escalating goals)

Badges pair with the achievements above — where an achievement is "do it once," its paired badges are "make it a habit." Suggested rendering: same medal plates already in `public/badges/512/`.

### Precision Badges (pair with Timing achievements)
| Badge | Requirement | Tier | XP |
|---|---|---|---|
| Minute Hand | 5 busts at exactly :00 | gold | 90 |
| Second Hand | 15 busts at exactly :00 | platinum | 180 |
| Buzzer Beater | 5 busts within 5 minutes of cooldown expiry | gold | 95 |
| Cooldown Surgeon | 15 busts within 5 minutes of cooldown expiry | mythic | 240 |
| Calendar Collector | Bust on 5 distinct holidays | platinum | 160 |
| Anniversary Chain | Bust on 3 consecutive account anniversaries | mythic | 300 |

### Squad Badges (pair with Social achievements)
| Badge | Requirement | Tier | XP |
|---|---|---|---|
| Wingman | 10 First-Responder-style replies (within 10 min of a crewmate) | gold | 100 |
| Squadron Leader | Trigger 5 Chain Reactions as the initiator | platinum | 170 |
| Twin Turbines | 5 Synchronized (within 60s) events | platinum | 175 |
| Opening Ceremony | First group bust of the day, 25 times | platinum | 190 |
| Iron Grip | Hold #1 on the all-time leaderboard for 7 consecutive days | mythic | 320 |
| Dynasty | Hold #1 for 30 consecutive days | mythic | 500 |

### Calendar Badges (pair with Consistency achievements)
| Badge | Requirement | Tier | XP |
|---|---|---|---|
| Payroll Regular | 4 separate Business-Hours weeks (Mon–Fri runs) | platinum | 150 |
| Perfect Month | Bust every day of one calendar month | mythic | 400 |
| Season Ticket | Bust in 12 consecutive calendar months | mythic | 350 |
| Metronome | 15 busts in your single most-repeated hour-of-day | gold | 110 |
| Phoenix | Break 3 separate 14-day dry spells | silver | 80 |
| Daily Double Decade | 10 days with 2+ busts | platinum | 165 |

### Expedition Badges (pair with Environment achievements)
| Badge | Requirement | Tier | XP |
|---|---|---|---|
| Weather Vane | Bust in all five pressure bands (Very Low → Very High) | platinum | 180 |
| Thermometer Breaker | Bust in five 20°F temperature bands (<32, 32–52, 52–72, 72–92, >92) | platinum | 185 |
| Storm Rider | 5 busts in Very Low pressure | platinum | 160 |
| Climate Diplomat | Busts from 3 different cities in one week | mythic | 260 |
| Odometer | 500 cumulative miles between consecutive bust locations | platinum | 170 |
| Landmark Legend | 25 busts from your Home Base city | gold | 120 |

### Wordsmith Badges (pair with Notes achievements)
| Badge | Requirement | Tier | XP |
|---|---|---|---|
| Emoji Dictionary | 25 distinct emoji used across all notes | gold | 100 |
| Poet Laureate | 5 haiku notes | platinum | 150 |
| Full Manuscript | 5 max-length (240 char) notes | gold | 105 |
| Minimalist Monk | 25 one-word notes | gold | 95 |
| Bard of the Bay | 10 notes containing archaic English | silver | 85 |

### Meta Badges (progression on progression)
| Badge | Requirement | Tier | XP |
|---|---|---|---|
| Completionist I | Unlock 25 total achievements/badges | gold | 120 |
| Completionist II | Unlock 50 total achievements/badges | platinum | 220 |
| Completionist III | Unlock ALL other achievements and badges | mythic | 1000 |
| XP Tycoon | Reach 2,000 lifetime XP | platinum | 200 |
| The Collector | Own at least one badge from every category | platinum | 190 |

---

## Implementation notes (when ready to build)
- All conditions are computable client-side from existing bust history except: leaderboard-hold durations (Iron Grip/Dynasty) and dry-spell tracking, which need either a daily snapshot table or derivation from full history (derivable — history contains everything).
- Distance-based items use the stored lat/long (haversine).
- Holiday/solstice dates can be a small static table in `rules.js`.
- Suggested rollout: Precision + Calendar first (pure timestamp math, no new data), then Expedition (needs distance helper), then Squad (needs group-feed scans), then Meta last.
