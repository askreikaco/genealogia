-- Relationship tables (schema only: no data is read or written here). Idempotent.
-- parent_child: one row per parent-child link. couple: one row per partnership (a = the side the link was added from).
-- Reads switch to these tables for a family only after scripts/rel-backfill.js --apply writes its relation_migrations row.
create table if not exists parent_child (
  id           bigserial primary key,
  family_id    text not null references families (id),
  parent_id    text not null references persons (id),
  child_id     text not null references persons (id),
  kind         text not null default 'ruot' check (kind in ('ruot', 'nuoi', 'ke', 'khac')),
  birth_order  int,
  private      boolean not null default false,
  created_at   timestamptz not null default now(),
  created_by   text,
  check (parent_id <> child_id),
  unique (family_id, parent_id, child_id)
);
create index if not exists parent_child_child_idx on parent_child (child_id);
create index if not exists parent_child_parent_idx on parent_child (parent_id);

create table if not exists couple (
  id          bigserial primary key,
  family_id   text not null references families (id),
  a_id        text not null references persons (id),
  b_id        text not null references persons (id),
  kind        text not null default 'cuoi' check (kind in ('cuoi', 'vo_le', 'ban_doi', 'ly_hon', 'goa', 'khac')),
  order_a     int,
  order_b     int,
  start_year  int,
  end_year    int,
  private     boolean not null default false,
  note        text,
  created_at  timestamptz not null default now(),
  created_by  text,
  check (a_id <> b_id)
);
-- Same as unique(family_id, a_id, b_id, kind, start_year) with a null year counted as one value (works on any PostgreSQL 9.5+).
create unique index if not exists couple_key on couple (family_id, a_id, b_id, kind, coalesce(start_year, -1));
create index if not exists couple_a_idx on couple (a_id);
create index if not exists couple_b_idx on couple (b_id);

-- One row per family whose relations were backfilled from the legacy person fields (written by rel-backfill --apply only).
create table if not exists relation_migrations (
  family_id    text primary key references families (id),
  migrated_at  timestamptz not null default now(),
  migrated_by  text,
  counts       jsonb not null default '{}'
);
