-- Tin họ (family news, kind 'notice' = Thông báo) and Lịch gatherings (kind 'gathering' = Họp mặt).
-- status: live (shown), held (waiting for an owner or admin: text checks, see content-rules.js), hidden (two member reports;
-- owners and admins review). deleted_at: soft delete. rsvps: one answer per account per gathering.
-- post_reminders: each reminder (3 and 1 days before) is recorded once. post_reports: one report per member per post.
-- families.news_posters: who may post: 'admin' (owners and admins, default) or 'editor' (plus editors).
create table if not exists posts (
  id          bigserial primary key,
  family_id   text not null,
  kind        text not null check (kind in ('notice', 'gathering')),
  title       text not null,
  body        text not null default '',
  pinned      boolean not null default false,
  starts_at   date,
  lunar       text,
  time        text,
  place       text,
  map_url     text,
  organiser   text,
  created_by  text not null,
  author_key  text not null default '',
  status      text not null default 'live' check (status in ('live', 'held', 'hidden')),
  hold        text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  check (kind = 'notice' or starts_at is not null)
);
alter table posts add column if not exists author_key text not null default '';
alter table posts add column if not exists status text not null default 'live';
alter table posts add column if not exists hold text[] not null default '{}';
create index if not exists posts_family_idx on posts (family_id, deleted_at, pinned, created_at desc);
create index if not exists posts_author_idx on posts (family_id, author_key, created_at);
create table if not exists rsvps (
  post_id     bigint not null references posts (id),
  account_key text not null,
  answer      text not null check (answer in ('yes', 'no', 'maybe')),
  at          timestamptz not null default now(),
  primary key (post_id, account_key)
);
create table if not exists post_reminders (
  post_id     bigint not null references posts (id),
  stage       int not null check (stage in (1, 3)),
  at          timestamptz not null default now(),
  primary key (post_id, stage)
);
create table if not exists post_reports (
  post_id      bigint not null references posts (id),
  reporter_key text not null,
  reason       text not null,
  at           timestamptz not null default now(),
  primary key (post_id, reporter_key)
);
alter table families add column if not exists news_posters text not null default 'admin';
alter table rsvps add column if not exists name text not null default '';
-- Personal calendar feed: one link per account and family; the token is stored only as a hash (news-cal.js).
create table if not exists cal_tokens (
  id           bigserial primary key,
  account_key  text not null,
  family_id    text not null,
  token_hash   text not null unique,
  follows      text[] not null default '{}',
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  last_fetch_at timestamptz
);
create index if not exists cal_tokens_acct_idx on cal_tokens (account_key, family_id) where revoked_at is null;
