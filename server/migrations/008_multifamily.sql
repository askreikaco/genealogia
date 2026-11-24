-- Multi-family: every person and suggestion belongs to one family; roles are per family (members.family_id).
-- Idempotent. Existing rows are backfilled to 'duong' by the column default.
alter table families add column if not exists slug text;
alter table families add column if not exists visibility text not null default 'public';
alter table families add column if not exists place text;
alter table families add column if not exists color text;
alter table families add column if not exists created_at timestamptz not null default now();
alter table families add column if not exists updated_at timestamptz not null default now();
update families set slug = id where slug is null;
update families set visibility = 'public' where visibility is null;
alter table families drop constraint if exists families_visibility_check;
alter table families add constraint families_visibility_check check (visibility in ('public', 'link', 'private'));
create unique index if not exists families_slug_key on families (slug);

alter table persons add column if not exists family_id text not null default 'duong';
create index if not exists persons_family_idx on persons (family_id, version);
alter table suggestions add column if not exists family_id text not null default 'duong';
create index if not exists suggestions_family_idx on suggestions (family_id, status, created_at desc);

-- One email may hold a role in several families: unique per (family, email), not per email alone.
alter table members drop constraint if exists members_email_key;
create unique index if not exists members_family_email_key on members (family_id, email);
create index if not exists members_email_idx on members (email);

-- Preferences keep their own shape; the API validates follows_families and default_family (see server.js).
