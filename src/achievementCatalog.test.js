/*
 * The achievement catalog exists in two places that must never disagree:
 *
 *   - src/rules.js, which the client and both Edge Functions compute unlocks from
 *   - achievement_catalog in Postgres, seeded by the core schema migration and
 *     referenced by a foreign key on achievements.achievement_type
 *
 * Drift is not a cosmetic problem. Adding an achievement to rules.js without
 * seeding its id makes every unlock of it fail the foreign key, so the whole
 * reconcile call 500s and the user silently stops earning ANYTHING. Removing an
 * id that rows still reference makes the migration itself unappliable.
 *
 * Parsing the migration is deliberate: comparing against a hand-copied list in
 * this file would just move the drift somewhere nobody looks.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { achievements } from './rules.js';

// Resolved from the repo root rather than import.meta.url: the jsdom test
// environment rewrites module URLs to http, which fileURLToPath rejects.
const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

/*
 * Every migration, not just the baseline. The catalog is seeded in more than one
 * place — the Bitcoin track arrived in its own migration — and a test that read
 * only the baseline would report those ids as missing and push someone into
 * "fixing" it by duplicating the list.
 */
function seededCatalogIds() {
  const ids = [];
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter(name => name.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const block of sql.matchAll(
      /insert into public\.achievement_catalog[\s\S]*?unnest\(array\[([\s\S]*?)\]\s*(?:::text\[\])?\s*\)\s*as/g
    )) {
      ids.push(...[...block[1].matchAll(/'([^']+)'/g)].map(match => match[1]));
    }
  }
  if (!ids.length) throw new Error('no achievement_catalog seed found in supabase/migrations');
  return ids;
}

describe('achievement catalog', () => {
  const seeded = seededCatalogIds();
  const declared = achievements.map(item => item.id);

  it('seeds every achievement declared in rules.js', () => {
    const missing = declared.filter(id => !seeded.includes(id));
    expect(missing, `not seeded in the catalog migration: ${missing.join(', ')}`).toEqual([]);
  });

  it('seeds nothing that rules.js does not declare', () => {
    const orphaned = seeded.filter(id => !declared.includes(id));
    expect(orphaned, `seeded but absent from rules.js: ${orphaned.join(', ')}`).toEqual([]);
  });

  // A duplicate would be absorbed by `on conflict do nothing`, so the seed still
  // works and the mistake stays invisible until someone reads the arrays.
  it('lists each id exactly once across all sources', () => {
    const dupes = seeded.filter((id, index) => seeded.indexOf(id) !== index);
    expect(dupes, `seeded more than once: ${[...new Set(dupes)].join(', ')}`).toEqual([]);
    expect(new Set(declared).size).toBe(declared.length);
  });
});
