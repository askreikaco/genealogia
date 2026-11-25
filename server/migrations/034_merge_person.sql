-- Merge of two duplicate people inside one tree (server/merge.js). A merge is a family decision like a removal
-- (decision-rules.js): kind 'merge_person', subject_ref = the person merged away, payload = { keep, choices }.
-- Additive and idempotent.
alter table decisions drop constraint if exists decisions_kind_check;
alter table decisions add constraint decisions_kind_check check (kind in ('remove_person', 'merge_person'));
alter table decisions add column if not exists payload jsonb not null default '{}';
