-- Family decisions (biểu quyết, COUNCIL.md). Now only kind 'remove_person' (server/decision-rules.js). subject_ref is the
-- person id. voters: fixed when the vote opens. decision_votes.choice: yes | no (a no needs a reason).
create table if not exists decisions (
  id          bigserial primary key,
  family_id   text not null,
  kind        text not null check (kind in ('remove_person')),
  subject_ref text not null,
  title       text not null default '',
  body        text not null default '',
  voters      jsonb not null default '[]',
  solo        boolean not null default false,
  state       text not null default 'open' check (state in ('open', 'passed', 'failed')),
  opened_by   text not null,
  opened_at   timestamptz not null default now(),
  closes_at   timestamptz not null,
  decided_at  timestamptz,
  result      jsonb
);
create unique index if not exists decisions_open_idx on decisions (kind, subject_ref) where state = 'open';
create index if not exists decisions_family_idx on decisions (family_id, state, opened_at desc);
create table if not exists decision_votes (
  decision_id bigint not null references decisions (id) on delete cascade,
  voter_key   text not null,
  choice      text not null check (choice in ('yes', 'no', 'abstain')),
  reason      text,
  at          timestamptz not null default now(),
  primary key (decision_id, voter_key)
);
-- Owners whose "đã mất" handover is open: they are not voters.
create table if not exists council_deceased (
  family_id text not null,
  email     text not null,
  seen_at   timestamptz not null default now(),
  primary key (family_id, email)
);
-- Who may vote on a removal: a family setting (Cài đặt dòng họ › Biểu quyết). A decision copies it when it opens.
alter table families add column if not exists vote_rule text not null default 'council';
alter table decisions add column if not exists vote_rule text not null default 'council';
-- Set when every eligible voter has voted (the time of the last vote then): the vote closes 10 minutes later.
alter table decisions add column if not exists all_voted_at timestamptz;
-- Family-level history (the person history table is per person): the vote-rule changes.
create table if not exists family_history (
  id        bigserial primary key,
  family_id text not null,
  field     text not null,
  old_value text,
  new_value text,
  by_user   text,
  at        timestamptz not null default now()
);
create index if not exists family_history_idx on family_history (family_id, at desc);
