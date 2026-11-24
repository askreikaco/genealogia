-- Succession engine state (see server/succession.js). handover_requests (006) keeps the request; these hold its steps,
-- the offers in chain order, and the daily job's last-run guard. Idempotent.
-- handover_steps: one row per stage change (history). The current stage is the newest step's stage.
create table if not exists handover_steps (
  id          bigserial primary key,
  request_id  int not null references handover_requests (id),
  at          timestamptz not null default now(),
  stage       text not null,
  actor       text,
  note        text,
  data        jsonb not null default '{}'
);
create index if not exists handover_steps_req_idx on handover_steps (request_id, at);

-- handover_offers: the chain for one handover, in order. waiting -> offered -> accepted | declined | expired | cancelled.
create table if not exists handover_offers (
  id              serial primary key,
  request_id      int not null references handover_requests (id),
  position        int not null,
  email           text not null,
  source          text not null check (source in ('contact', 'admin', 'editor')),
  status          text not null default 'waiting' check (status in ('waiting', 'offered', 'accepted', 'declined', 'expired', 'cancelled')),
  token_hash      text,
  offered_at      timestamptz,
  expires_at      timestamptz,
  code_hash       text,
  code_expires_at timestamptz,
  code_attempts   int not null default 0,
  resolved_at     timestamptz
);
create index if not exists handover_offers_req_idx on handover_offers (request_id, position);
create index if not exists handover_offers_token_idx on handover_offers (token_hash);

-- job_runs: last run of a daily job (the server checks it hourly and runs the job when the last run is over 20 h old).
create table if not exists job_runs (
  name         text primary key,
  last_run_at  timestamptz not null,
  last_result  jsonb not null default '{}'
);
