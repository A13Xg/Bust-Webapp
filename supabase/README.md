# Supabase deployment

The repository uses `supabase/setup.sql` as the initial bootstrap and versioned files under `supabase/migrations/` for subsequent schema hardening.

## Required order

```text
1. Run supabase/setup.sql on a new project.
2. Apply every supabase/migrations/*.sql file in filename order.
3. Deploy the reconcile-achievements Edge Function.
```

Current function deployment:

```bash
supabase functions deploy reconcile-achievements
```

Do not rerun only `setup.sql` and assume the database is current. The migration directory is part of the canonical schema state.

## Security boundaries

- Browser clients use only the anon key.
- Direct achievement inserts remain blocked by RLS.
- Full-catalog achievement evaluation runs in the authenticated Edge Function.
- The service-role key exists only in the Supabase function environment.
- Atomic bust cooldown enforcement is installed by the versioned cooldown migration.

## Release verification

- Apply the deployment sequence to both an empty project and an existing project.
- Confirm two concurrent bust inserts for one account yield one success.
- Confirm a forged achievement insert fails.
- Confirm two reconciliation calls are idempotent.
- Confirm expansion, social, and meta achievements persist through the Edge Function.
- Confirm histories larger than 1,000 rows are fully reconciled.
