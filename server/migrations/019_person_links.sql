-- "Same person" links between two family trees (all trees equal: a link joins two records, it never moves or copies data).
-- a_* = the tree that proposed the link, b_* = the tree that accepts it. Additive and idempotent.
create table if not exists person_links (
  id serial primary key,
  a_family text not null, a_person text not null,
  b_family text not null, b_person text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  reason text,
  proposed_by text, accepted_by text,
  created_at timestamptz not null default now(), decided_at timestamptz
);
create unique index if not exists person_links_pair on person_links
  (least(a_family || ':' || a_person, b_family || ':' || b_person), greatest(a_family || ':' || a_person, b_family || ':' || b_person));
create index if not exists person_links_a on person_links (a_family, a_person);
create index if not exists person_links_b on person_links (b_family, b_person);
