# Achievement reconciliation Edge Function

This function is the authoritative achievement evaluator for static Supabase deployments.

It authenticates the caller with the supplied user JWT, reads complete paginated history with the service-role client, imports the same `computeAchievementUnlocks` implementation and achievement catalog used by the Express server, persists only server-computed catalog IDs, and returns the complete achievement collection.

This provides parity for legacy, progression, expansion, social, and meta achievements without duplicating rule logic in SQL.

## Deploy

From the repository root:

```bash
supabase functions deploy reconcile-achievements
```

Supabase automatically provides these function secrets:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Do not expose `SUPABASE_SERVICE_ROLE_KEY` to the browser or add it to any `VITE_` environment variable.

## Verification

1. Confirm direct inserts into `public.achievements` fail for an authenticated browser client.
2. Invoke the function twice for the same account and confirm no duplicate `(user_id, achievement_type)` rows are created.
3. Seed qualifying legacy, progression, expansion, social, and meta history and verify the returned IDs match `computeAchievementUnlocks` for the same fixture.
4. Seed more than 1,000 busts and achievements and verify pagination returns complete results.
5. Invoke the function without an Authorization header and confirm it returns HTTP 401.

## Deployment dependency

The function imports `../../../src/rules.js` and `../../../src/fetchAllPages.js`. Deploy it from the repository root so the Supabase bundler can resolve the canonical modules. A deployment should fail rather than silently fall back to the older partial SQL reconciler if those imports cannot be bundled.

JWT verification is explicitly enabled in `supabase/config.toml`.
