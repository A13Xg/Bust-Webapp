# Supabase deployment

The repository uses `supabase/setup.sql` as the initial bootstrap and versioned files under `supabase/migrations/` for subsequent schema hardening.

## Required order

```text
1. Run supabase/setup.sql on a new project.
2. Apply every supabase/migrations/*.sql file in filename order.
3. Deploy Edge Functions:
   - reconcile-achievements
   - register-push-subscription
   - dispatch-inactivity-reminders
```

Current function deployment:

```bash
supabase functions deploy reconcile-achievements
supabase functions deploy register-push-subscription
supabase functions deploy dispatch-inactivity-reminders
```

Set function secrets before deploying reminder delivery:

```bash
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... REMINDER_CRON_SECRET=...
```

Do not rerun only `setup.sql` and assume the database is current. The migration directory is part of the canonical schema state.

## Security boundaries

- Browser clients use only the anon key.
- Direct achievement inserts remain blocked by RLS.
- Full-catalog achievement evaluation runs in the authenticated Edge Function.
- The service-role key exists only in the Supabase function environment.
- Atomic bust cooldown enforcement is installed by the versioned cooldown migration.
- Push reminders are dispatched server-side from `dispatch-inactivity-reminders` via VAPID.
- Reminder cadence state is persisted in `public.inactivity_reminders`, reset on each successful bust.

## Release verification

- Apply the deployment sequence to both an empty project and an existing project.
- Confirm two concurrent bust inserts for one account yield one success.
- Confirm a forged achievement insert fails.
- Confirm two reconciliation calls are idempotent.
- Confirm expansion, social, and meta achievements persist through the Edge Function.
- Confirm histories larger than 1,000 rows are fully reconciled.

## Time semantics

Express and static Supabase reconciliation execute the same JavaScript evaluator, removing backend-specific SQL timezone drift. Calendar achievements still use the evaluator runtime's local calendar timezone. Moving to a persisted user or event timezone would be a separate product and data migration rather than a silent behavior change.
