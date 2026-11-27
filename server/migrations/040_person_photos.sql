-- Gallery per person (G1, server/gallery.js): up to 20 photos per person, each with an optional caption and year.
-- One row is the profile photo; persons.data.photo mirrors it (back-compat: the old single field stays readable).
-- Photos are the event photos' store: http(s) links or uploads (/api/photos/<24 hex>). Visibility = the person's
-- (a living person's photos go to members only; see photoAccess in server.js). Removal goes to the trash (kind 'photo').
-- Idempotent. down (manual): delete the trash rows of kind 'photo' first, then
--   drop table if exists person_photos; alter table trash drop constraint if exists trash_kind_check,
--   add constraint trash_kind_check check (kind in ('person','event','story','parent_child','couple','place_link','person_link'));
create table if not exists person_photos (
  id          text primary key,
  family_id   text not null,
  person_id   text not null,
  url         text not null,
  caption     text not null default '',
  year        integer,
  is_profile  boolean not null default false,
  position    integer not null default 0,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists person_photos_person_idx on person_photos (family_id, person_id, position);
create index if not exists person_photos_url_idx on person_photos (url);

-- The one photo each person had (persons.data.photo) becomes the profile photo of its gallery. Once per person:
-- a person that already has gallery rows is left alone, so a re-run changes nothing.
insert into person_photos (id, family_id, person_id, url, is_profile, position, created_by)
select substr(md5(p.family_id || '|' || p.id || '|photo'), 1, 24), p.family_id, p.id, p.data->>'photo', true, 0, 'migration'
from persons p
where coalesce(p.data->>'photo', '') <> ''
  and not exists (select 1 from person_photos x where x.family_id = p.family_id and x.person_id = p.id)
on conflict (id) do nothing;

-- the trash keeps a removed gallery photo like any other removed item
alter table trash drop constraint if exists trash_kind_check;
alter table trash add constraint trash_kind_check check (kind in ('person', 'event', 'story', 'parent_child', 'couple', 'place_link', 'person_link', 'photo'));
