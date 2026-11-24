-- giapha: one row per person, fields in jsonb, per-field clock for newest-wins sync.
-- Idempotent: safe to re-run.
create sequence if not exists persons_version;

create table if not exists persons (
  id          text primary key,             -- P001, P329, ...
  data        jsonb not null default '{}',  -- name, gen, parent, spouse, born, died, ...
  field_ts    jsonb not null default '{}',  -- field -> client ts (ms) of the last applied write
  version     bigint not null default nextval('persons_version'),
  deleted     boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create index if not exists persons_version_idx on persons (version);

-- Idempotency: a retried op is applied once.
create table if not exists ops (
  op_id      text primary key,
  person_id  text not null,
  applied_at timestamptz not null default now()
);

-- Edit history (who changed what). Never deleted by the app.
create table if not exists history (
  id         bigserial primary key,
  person_id  text not null,
  field      text not null,
  old_value  jsonb,
  new_value  jsonb,
  by_user    text,
  source     text not null default 'app',   -- app | sheet | seed
  at         timestamptz not null default now()
);
create index if not exists history_person_idx on history (person_id, at desc);
