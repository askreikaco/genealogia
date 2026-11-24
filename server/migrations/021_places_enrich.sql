-- Places step 3: open data enrichment. A new place gets a job; a worker (off unless PLACES_ENRICH=1) asks Wikidata
-- (CC0) and GeoNames (CC BY 4.0, only with a GEONAMES_USER) for candidates and stores what it found as SUGGESTIONS.
-- A curator (owner or admin of a family) accepts or rejects each one. Our copy stays authoritative: an accepted
-- suggestion only fills an empty field or adds a name; it never overwrites. Additive and idempotent.
create table if not exists places_enrich_jobs (
  id serial primary key,
  place_id int not null references places(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  tries int not null default 0,
  next_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists places_enrich_jobs_open on places_enrich_jobs (place_id) where status in ('queued', 'running');
create index if not exists places_enrich_jobs_next on places_enrich_jobs (next_at) where status = 'queued';

create table if not exists place_suggestions (
  id serial primary key,
  place_id int not null references places(id) on delete cascade,
  source text not null check (source in ('wikidata', 'geonames')),
  external_id text not null,
  field text not null check (field in ('wikidata_id', 'geonames_id', 'coords', 'official_code', 'name')),
  value jsonb not null,
  confidence real not null default 0,
  licence text not null,
  attribution text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  decided_by text, decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists place_suggestions_uniq on place_suggestions (place_id, source, field, md5(value::text));
create index if not exists place_suggestions_pending on place_suggestions (place_id) where status = 'pending';

-- Where a filled value came from, so the place page can credit it (GeoNames asks for attribution).
alter table places add column if not exists coords_source text;
alter table place_names add column if not exists licence text;
