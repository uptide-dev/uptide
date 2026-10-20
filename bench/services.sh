# Sourced by run.sh and check.sh: a fresh Postgres for a repository whose selection entry has
# `postgres`, the same for both arms, the human reference and the final checks. The database is
# recreated for every run, so one run cannot affect the next. Trust auth: Uptide's verification
# drops variables named like *PASSWORD* from the commands it runs, so no password is needed.
# Exports PGHOST, PGPORT, PGUSER, PGDATABASE: none is a secret.
fresh_postgres() { # <selection.json> <id>
  local pg
  pg=$(jq -c --arg id "$2" '.repos[] | select(.id == $id) | .postgres // empty' "$1")
  [ -n "$pg" ] || return 0
  local image port user db
  image=$(jq -r .image <<<"$pg") port=$(jq -r .port <<<"$pg") user=$(jq -r .user <<<"$pg") db=$(jq -r .database <<<"$pg")
  docker rm -f ub-bench-pg >/dev/null 2>&1 || :
  docker run -d --name ub-bench-pg -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_USER="$user" \
    -e POSTGRES_DB="$db" -p "127.0.0.1:$port:5432" "$image" >/dev/null
  until docker exec ub-bench-pg pg_isready -U "$user" -d "$db" >/dev/null 2>&1; do sleep 1; done
  sleep 2 # pg_isready answers during the image's init restart; let it settle.
  until docker exec ub-bench-pg pg_isready -U "$user" -d "$db" >/dev/null 2>&1; do sleep 1; done
  export PGHOST=127.0.0.1 PGPORT=$port PGUSER=$user PGDATABASE=$db
}
