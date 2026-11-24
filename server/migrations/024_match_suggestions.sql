-- "Có thể là cùng một người": suggestions from the match job (scripts/match-run.js), one row per person pair across
-- two trees. A suggestion never links anything: "Đề nghị liên kết" goes through person_links (019) and the other tree
-- still decides. A dismissed or linked pair is never revived by a later run. Additive and idempotent.
create table if not exists match_suggestions (
  id serial primary key,
  a_family text not null, a_person text not null references persons(id) on delete cascade,
  b_family text not null, b_person text not null references persons(id) on delete cascade,
  score real not null check (score >= 0 and score <= 1),
  reasons jsonb not null default '[]',
  status text not null default 'new' check (status in ('new', 'dismissed', 'linked')),
  computed_at timestamptz not null default now(),
  decided_by text, decided_at timestamptz,
  check (a_person <> b_person)
);
create unique index if not exists match_suggestions_pair on match_suggestions (least(a_person, b_person), greatest(a_person, b_person));
create index if not exists match_suggestions_a on match_suggestions (a_family, status);
create index if not exists match_suggestions_b on match_suggestions (b_family, status);
