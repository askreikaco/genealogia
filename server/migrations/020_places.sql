-- Places: one shared gazetteer for every family on the instance. A place keeps its names and its parent
-- jurisdictions over time; people keep the text exactly as the source wrote it, next to an optional place id.
-- Additive and idempotent. No data is moved here (matching existing text is a separate, dry-run-first step).
create table if not exists places (
  id serial primary key,
  kind text not null default 'other' check (kind in ('country', 'province', 'district', 'commune', 'village', 'hamlet', 'cemetery', 'temple', 'other')),
  lat double precision, lon double precision,
  precision text check (precision in ('exact', 'village', 'commune', 'district', 'province', 'country')),
  wikidata_id text check (wikidata_id ~ '^Q[0-9]+$'),
  geonames_id bigint,
  official_code text,                 -- national administrative unit code where one exists
  status text not null default 'pending' check (status in ('verified', 'pending')),
  note text,
  created_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists places_wikidata on places (wikidata_id) where wikidata_id is not null;
create unique index if not exists places_geonames on places (geonames_id) where geonames_id is not null;

-- Names over time (and in other scripts: Hán, Nôm, French, ...). valid_from / valid_to are ISO dates or years
-- ('1698', '1976-07-02'); null = open. name_fold = lower case without accents, for search.
create table if not exists place_names (
  id serial primary key,
  place_id int not null references places(id) on delete cascade,
  name text not null,
  name_fold text not null,
  lang text not null default 'vi',
  valid_from text, valid_to text,
  is_primary boolean not null default false,
  source text
);
create index if not exists place_names_place on place_names (place_id);
create index if not exists place_names_fold on place_names (name_fold text_pattern_ops);

-- "Part of" over time: a commune in one district until a reform, in another after it.
create table if not exists place_parents (
  place_id int not null references places(id) on delete cascade,
  parent_id int not null references places(id) on delete cascade,
  valid_from text, valid_to text,
  source text,
  check (place_id <> parent_id)
);
create index if not exists place_parents_place on place_parents (place_id);

-- Changes: renamed, merged into, split from, upgraded, abolished (with the other place where there is one).
create table if not exists place_events (
  id serial primary key,
  place_id int not null references places(id) on delete cascade,
  date text not null,
  kind text not null check (kind in ('renamed', 'merged_into', 'split_from', 'upgraded', 'abolished', 'created')),
  other_place_id int references places(id) on delete set null,
  source text
);
create index if not exists place_events_place on place_events (place_id);

-- A person's place fields point here; persons.data keeps the text as written (never rewritten).
create table if not exists person_places (
  person_id text not null references persons(id) on delete cascade,
  field text not null check (field in ('place', 'birth_place', 'death_place', 'burial', 'address', 'que_goc')),
  place_id int not null references places(id) on delete restrict,
  as_written text not null default '',
  matched_by text, matched_at timestamptz not null default now(),
  primary key (person_id, field)
);
create index if not exists person_places_place on person_places (place_id);
