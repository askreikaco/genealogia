-- Two-way Google Sheet sync: last state both sides agreed on, per person (lets us tell Sheet edits from app edits).
create table if not exists sheet_snap (
  person_id text primary key,
  data      jsonb not null,
  synced_at timestamptz not null default now()
);
