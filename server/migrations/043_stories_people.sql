-- Stories about several people: the people tagged in a story (person ids of the same family). A story shows on its
-- owner's profile (person_id) and on the profile of each tagged person. Idempotent.
alter table stories add column if not exists people jsonb not null default '[]';
create index if not exists stories_people_idx on stories using gin (people);
