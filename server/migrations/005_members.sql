-- Members and roles. Roles per family: owner (Chủ họ), admin (Quản trị), editor (Biên tập), member (Thành viên).
-- guest (Khách) = not signed in, or signed in without an active row here. Idempotent.
create table if not exists members (
  id           serial primary key,
  email        text unique not null,          -- lower-case, Google account email
  name         text,                          -- display name (account name or invited name)
  family_id    text not null default 'duong',
  role         text not null default 'member' check (role in ('owner', 'admin', 'editor', 'member')),
  status       text not null default 'pending' check (status in ('pending', 'active', 'removed')),
  person_id    text,                          -- linked person record (null until approved / not in tree)
  relation     text check (relation in ('self', 'child_of', 'spouse_of', 'grandchild_of')),
  rel_person_id text,                         -- anchor person for relation when person_id is null
  first_name   text,                          -- Tên
  last_name    text,                          -- Họ
  created_at   timestamptz not null default now(),
  approved_by  text,
  approved_at  timestamptz,
  last_seen_at timestamptz                    -- set on authenticated requests, at most once an hour
);
alter table members add column if not exists last_seen_at timestamptz;
create index if not exists members_family_status_idx on members (family_id, status);
