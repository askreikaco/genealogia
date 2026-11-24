-- Anonymous suggestions (no sign-in): a visitor's proposed change waits in this table until an editor approves it.
-- Approval applies `changes` through the same op path as an editor edit (history + ops). Never read by the public API.
create table if not exists suggestions (
  id          serial primary key,
  person_id   text,                          -- null = a new person
  changes     jsonb not null,                -- field -> new value (FIELDS keys only, checked on suggest)
  note        text,
  by_name     text,
  by_contact  text,                          -- editors only
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),
  ip_hash     text,                          -- sha256(ip + server secret); never shown
  reviewed_by text,
  reviewed_at timestamptz,
  reason      text
);
create index if not exists suggestions_status_idx on suggestions (status, created_at desc);
