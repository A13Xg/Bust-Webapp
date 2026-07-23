#!/usr/bin/env bash
set -euo pipefail

require() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required secret or variable: $name" >&2
    exit 1
  fi
}

require SUPABASE_ACCESS_TOKEN
require SUPABASE_PROJECT_REF
require SUPABASE_DB_PASSWORD

if [[ "${RUN_SMOKE_TESTS:-false}" == "true" ]]; then
  require SUPABASE_ANON_KEY
  require SUPABASE_SERVICE_ROLE_KEY
fi

supabase link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD"
supabase db push --dry-run --include-all

if [[ "${APPLY_MIGRATIONS:-true}" == "true" ]]; then
  supabase db push --include-all --yes
fi

if [[ "${DEPLOY_FUNCTION:-true}" == "true" ]]; then
  supabase functions deploy reconcile-achievements --project-ref "$SUPABASE_PROJECT_REF" --use-api

  unauthorized_status=$(curl --silent --output /tmp/unauthorized.json --write-out '%{http_code}' \
    --request POST \
    --header "apikey: $SUPABASE_ANON_KEY" \
    "https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/reconcile-achievements")
  [[ "$unauthorized_status" == "401" ]]
fi

if [[ "${RUN_SMOKE_TESTS:-false}" != "true" ]]; then
  exit 0
fi

base="https://${SUPABASE_PROJECT_REF}.supabase.co"
email="release-check-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}@bust-ops.invalid"
password="ReleaseCheck-${GITHUB_RUN_ID}-Aa1!"
user_id=''

cleanup() {
  if [[ -n "$user_id" ]]; then
    curl --silent --show-error --fail \
      --request DELETE \
      --header "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
      --header "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      "$base/auth/v1/admin/users/$user_id" >/dev/null || true
  fi
}
trap cleanup EXIT

create=$(curl --silent --show-error --fail \
  --request POST \
  --header "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  --header "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  --header 'Content-Type: application/json' \
  --data "{\"email\":\"$email\",\"password\":\"$password\",\"email_confirm\":true}" \
  "$base/auth/v1/admin/users")
user_id=$(jq -r '.id' <<<"$create")
[[ -n "$user_id" && "$user_id" != "null" ]]

curl --silent --show-error --fail \
  --request POST \
  --header "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  --header "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  --header 'Content-Type: application/json' \
  --header 'Prefer: return=minimal' \
  --data "{\"id\":\"$user_id\",\"username\":\"release_check_${GITHUB_RUN_ID}\",\"avatar_seed\":\"release-check\"}" \
  "$base/rest/v1/profiles" >/dev/null

session=$(curl --silent --show-error --fail \
  --request POST \
  --header "apikey: $SUPABASE_ANON_KEY" \
  --header 'Content-Type: application/json' \
  --data "{\"email\":\"$email\",\"password\":\"$password\"}" \
  "$base/auth/v1/token?grant_type=password")
token=$(jq -r '.access_token' <<<"$session")
[[ -n "$token" && "$token" != "null" ]]

payload="{\"user_id\":\"$user_id\",\"timestamp\":\"2000-01-01T00:00:00.000Z\",\"note\":\"release verification\",\"time_bucket\":\"Night\"}"
request_bust() {
  curl --silent --output "$1" --write-out '%{http_code}' \
    --request POST \
    --header "apikey: $SUPABASE_ANON_KEY" \
    --header "Authorization: Bearer $token" \
    --header 'Content-Type: application/json' \
    --header 'Prefer: return=representation' \
    --data "$payload" \
    "$base/rest/v1/busts"
}

request_bust /tmp/bust-a.json >/tmp/status-a &
pid_a=$!
request_bust /tmp/bust-b.json >/tmp/status-b &
pid_b=$!
wait "$pid_a" || true
wait "$pid_b" || true

successes=$(printf '%s\n%s\n' "$(cat /tmp/status-a)" "$(cat /tmp/status-b)" | grep -c '^201$' || true)
[[ "$successes" -eq 1 ]]

forged_status=$(curl --silent --output /tmp/forged.json --write-out '%{http_code}' \
  --request POST \
  --header "apikey: $SUPABASE_ANON_KEY" \
  --header "Authorization: Bearer $token" \
  --header 'Content-Type: application/json' \
  --data "{\"user_id\":\"$user_id\",\"achievement_type\":\"forged_release_check\"}" \
  "$base/rest/v1/achievements")
[[ "$forged_status" -ge 400 ]]

invoke() {
  curl --silent --show-error --fail \
    --request POST \
    --header "apikey: $SUPABASE_ANON_KEY" \
    --header "Authorization: Bearer $token" \
    --header 'Content-Type: application/json' \
    "$base/functions/v1/reconcile-achievements"
}

invoke >/tmp/reconcile-1.json
invoke >/tmp/reconcile-2.json
jq -e '.achievements | type == "array"' /tmp/reconcile-1.json >/dev/null
jq -S '[.achievements[].achievement_type] | sort' /tmp/reconcile-1.json >/tmp/types-1.json
jq -S '[.achievements[].achievement_type] | sort' /tmp/reconcile-2.json >/tmp/types-2.json
diff -u /tmp/types-1.json /tmp/types-2.json
