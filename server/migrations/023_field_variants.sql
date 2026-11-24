-- Conflicting data, step 1: several sourced values ("variants") for one person field. The app never decides truth:
-- every value is kept with its source, who recorded it and how reliable it is; editors choose which one the profile
-- shows (the person field itself, written through the normal op + history). Additive and idempotent.
create table if not exists field_variants (
  id serial primary key,
  person_id text not null,
  family_id text not null,
  field text not null check (field in ('name', 'born', 'died', 'birth_place', 'place', 'burial')),
  value jsonb not null,
  source text,
  quality text not null default 'binh_thuong' check (quality in ('rat_thap', 'thap', 'binh_thuong', 'cao', 'rat_cao')),
  by_user text,
  chosen boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists field_variants_person on field_variants (person_id, field);
create unique index if not exists field_variants_one_chosen on field_variants (person_id, field) where chosen;
create unique index if not exists field_variants_same on field_variants (person_id, field, value);
