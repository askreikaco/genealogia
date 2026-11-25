-- Consistency checker (consistency-rules.js, consistency-routes.js): issues a member chose to hide (the Ignore button is UI only).
-- Keyed by tree, rule id and the sorted person ids of the issue. Additive, idempotent.
-- down (manual): drop table if exists consistency_ignores;
create table if not exists consistency_ignores (
  tree_id         text not null references families (id) on delete cascade,
  rule            text not null,
  person_ids_key  text not null,
  ignored_by      text not null default '',
  ignored_at      timestamptz not null default now(),
  primary key (tree_id, rule, person_ids_key)
);
