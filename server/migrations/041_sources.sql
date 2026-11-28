-- Reusable family sources (E2): one row per document or record a family cites (a family book, a grave, a paper,
-- an oral account, a web page). Events cite them: an events.sources item carries source_id and page (events.js).
-- Soft delete (deleted_at): a source in use is refused by the API, so no citation points at a deleted row.
-- Idempotent: CREATE IF NOT EXISTS only.
create table if not exists sources (
  id          text primary key,                  -- D + 12 hex
  family_id   text not null references families (id),
  title       text not null check (length(btrim(title)) > 0),
  kind        text not null default 'khac' check (kind in ('gia_pha','bia_mo','giay_to','loi_ke','web','khac')),
  author      text,
  year        int check (year is null or year between 0 and 9999),
  url         text,
  note        text,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists sources_family_idx on sources (family_id);
