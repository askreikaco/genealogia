#!/usr/bin/env bash
# Throwaway Postgres 16 for the giapha CI job (local data only, no secrets).
#   ci-db.sh start  -> starts a server, runs migrate.js twice and seed.js twice (GP_DEMO_SEED=1: the fictional demo family), writes GP_TEST_DATABASE_URL
#                      to $GITHUB_ENV (or prints it)
#   ci-db.sh stop   -> stops it and removes its files (run in an `if: always()` step)
# Backend, first that works:
#   1. docker (postgres:16 container, random host port)
#   2. local binaries: initdb/pg_ctl/psql on PATH, pg_config --bindir, /usr/lib/postgresql/*/bin
#      run as the 'postgres' user when this shell is root (initdb refuses root).
set -Eeuo pipefail   # -E: the ERR trap also fires inside functions
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/giapha-ci-pg"
STATE_FILE="$BASE/state.env"

free_port() { # a port this host can bind right now (bind test, not a connect test: a connect test misses a port nobody listens on yet)
  local p i
  for i in $(seq 1 50); do
    p=$((20000 + RANDOM % 30000))
    if node -e "const s=require('net').createServer();s.once('error',()=>process.exit(1));s.listen($p,'127.0.0.1',()=>s.close(()=>process.exit(0)))" 2>/dev/null; then echo "$p"; return; fi
  done
  echo "could not find a free port" >&2; exit 1
}

find_pg_bin() { # echoes a directory holding initdb, or nothing
  local d
  if command -v initdb >/dev/null 2>&1; then dirname "$(command -v initdb)"; return; fi
  if command -v pg_config >/dev/null 2>&1; then d="$(pg_config --bindir 2>/dev/null || true)"; [ -x "$d/initdb" ] && { echo "$d"; return; }; fi
  for d in /usr/lib/postgresql/*/bin /usr/pgsql-*/bin /usr/local/pgsql/bin; do [ -x "$d/initdb" ] && { echo "$d"; return; }; done
}

write_url() { # $1 = url
  if [ -n "${GITHUB_ENV:-}" ]; then echo "GP_TEST_DATABASE_URL=$1" >> "$GITHUB_ENV"; else echo "GP_TEST_DATABASE_URL=$1"; fi
}

# Waits until the server accepts real connections over TCP from this host, twice in a row (the official Postgres
# image starts a temporary socket-only server first, so an in-container pg_isready can pass before the host can connect:
# that was the ECONNREFUSED flake). Gives up after 90 s with the last error and the server log.
wait_ready() { # $1 = url
  local i ok=0 err="$BASE/ready.err"
  for i in $(seq 1 90); do
    if (cd "$ROOT/server" && DATABASE_URL="$1" node -e "const {Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL});c.connect().then(()=>c.end()).catch(e=>{console.error(e.message);process.exit(1)})") 2>"$err"; then
      ok=$((ok + 1)); [ "$ok" -ge 2 ] && return 0
    else
      ok=0
    fi
    sleep 1
  done
  echo "database not ready after 90 s: $(cat "$err" 2>/dev/null)" >&2
  dump_logs
  return 1
}

# Prints what the database printed (docker logs or the local server log) so a failed CI run shows the cause.
dump_logs() {
  echo "--- initdb log (tail) ---" >&2; tail -n 40 "$BASE/initdb.log" >&2 2>/dev/null || true
  echo "--- database log (tail) ---" >&2
  if [ -f "$STATE_FILE" ] && grep -q '^BACKEND=docker' "$STATE_FILE"; then
    . "$STATE_FILE"; docker logs --tail 80 "$NAME" >&2 2>&1 || true
  else
    tail -n 80 "$BASE/pg.log" >&2 2>/dev/null || true
  fi
}

migrate_and_seed() { # $1 = url
  wait_ready "$1" || return 1
  [ -f "$ROOT/server/seed/demo-persons.json" ] || (mkdir -p "$ROOT/server/seed" && node "$ROOT/scripts/make-demo-seed.mjs")
  (cd "$ROOT/server" && export DATABASE_URL="$1" GP_DEMO_SEED=1 && node scripts/migrate.js && node scripts/migrate.js && node scripts/seed.js && node scripts/seed.js)
}

start_docker() { # one attempt: a fresh container on a fresh port, then wait until the host can connect; 0 when ready
  local port name
  port="$(free_port)"; name="giapha-ci-pg-$port"
  echo "BACKEND=docker NAME=$name PORT=$port" > "$STATE_FILE"
  if ! docker run -d --rm --name "$name" --tmpfs /var/lib/postgresql/data:rw -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=giapha_ci -p "127.0.0.1:$port:5432" postgres:16-alpine >/dev/null; then
    echo "docker run failed on port $port" >&2; return 1
  fi
  for _ in $(seq 1 90); do docker exec "$name" pg_isready -h 127.0.0.1 -U postgres -d giapha_ci >/dev/null 2>&1 && break; sleep 1; done
  DB_URL="postgres://postgres@127.0.0.1:$port/giapha_ci"
  wait_ready "$DB_URL"
}

drop_docker() { # removes the container from the state file (stop is safe to call twice)
  [ -f "$STATE_FILE" ] || return 0
  # shellcheck disable=SC1090
  . "$STATE_FILE"; [ "${BACKEND:-}" = docker ] && docker rm -f -v "$NAME" >/dev/null 2>&1 || true
}

start() {
  rm -rf "$BASE"; mkdir -p "$BASE"
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    # One retry with a fresh container and port: a port race or a slow first start is not a reason to fail the job.
    local attempt
    for attempt in 1 2; do
      if start_docker; then
        migrate_and_seed "$DB_URL"; write_url "$DB_URL"
        return 0
      fi
      echo "attempt $attempt: Postgres container did not come up" >&2
      dump_logs; drop_docker
    done
    echo "docker could not start Postgres twice" >&2; exit 1
  else
    local port bin; port="$(free_port)"; bin="$(find_pg_bin || true)"   # a missing binary is reported below, not a silent exit
    [ -n "$bin" ] || { echo "no Postgres: no docker and no initdb/pg_ctl found (PATH, pg_config, /usr/lib/postgresql)" >&2; exit 1; }
    local run=""; local owner="$(id -un)"
    if [ "$(id -u)" = 0 ]; then
      id postgres >/dev/null 2>&1 || { echo "root shell and no 'postgres' user: cannot run initdb" >&2; exit 1; }
      owner=postgres; run="su postgres -s /bin/bash -c"
      chown postgres:postgres "$BASE"
    fi
    if [ -n "$run" ]; then
      $run "'$bin/initdb' -D '$BASE/data' -U postgres --auth=trust > '$BASE/initdb.log' 2>&1"
      $run "'$bin/pg_ctl' -D '$BASE/data' -o '-p $port -k $BASE -c listen_addresses=127.0.0.1' -l '$BASE/pg.log' -w start >/dev/null"
      $run "'$bin/psql' -h 127.0.0.1 -p $port -U postgres -qc 'create database giapha_ci'"
    else
      "$bin/initdb" -D "$BASE/data" -U postgres --auth=trust > "$BASE/initdb.log" 2>&1
      "$bin/pg_ctl" -D "$BASE/data" -o "-p $port -k $BASE -c listen_addresses=127.0.0.1" -l "$BASE/pg.log" -w start >/dev/null
      "$bin/psql" -h 127.0.0.1 -p "$port" -U postgres -qc 'create database giapha_ci'
    fi
    echo "BACKEND=local BIN=$bin RUNAS=$owner PORT=$port" > "$STATE_FILE"
  fi
  DB_URL="postgres://postgres@127.0.0.1:$port/giapha_ci"
  migrate_and_seed "$DB_URL"
  write_url "$DB_URL"
}

stop() {
  [ -f "$STATE_FILE" ] || { echo "nothing to stop"; return 0; }
  # shellcheck disable=SC1090
  . "$STATE_FILE"
  if [ "${BACKEND:-}" = docker ]; then
    docker rm -f -v "$NAME" >/dev/null 2>&1 || true
  else
    local bin="$BIN" stopcmd="'$BIN/pg_ctl' -D '$BASE/data' -m fast stop >/dev/null 2>&1 || true"
    if [ "$(id -u)" = 0 ] && [ "${RUNAS:-}" = postgres ]; then su postgres -s /bin/bash -c "$stopcmd"; else eval "$stopcmd"; fi
  fi
  rm -rf "$BASE"
}

case "${1:-}" in
  start) trap 'echo "start failed; cleaning up" >&2; dump_logs; stop || true' ERR; start ;;
  stop) stop ;;
  *) echo "usage: $0 start|stop" >&2; exit 2 ;;
esac
