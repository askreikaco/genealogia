-- Life events and stories (see web/js/events.js for the rules and the GEDCOM type mapping). Idempotent: CREATE only.
-- events: one row per fact of one person. Dates are ISO partials (YYYY, YYYY-MM, YYYY-MM-DD), kind says how to read them.
-- Privacy is by person (a living person's events: members only), so there is no per-event privacy column.
create table if not exists events (
  id           text primary key,                 -- E + 12 hex
  family_id    text not null references families (id),
  person_id    text not null references persons (id),
  type         text not null check (type in ('sinh','cuoi','ly_hon','chuyen_nha','hoc','nghe','quan_ngu','thanh_tich','ton_giao','mat','an_tang','khac')),
  date_text    text,                             -- the date as typed (display and search)
  date_kind    text check (date_kind in ('exact','about','before','after','between')),
  date_from    text,
  date_to      text,
  lunar        text,                             -- lunar date as typed ("15/8 ÂL"), display only
  place        text,
  place_new    text,                             -- the place's name after 2025 (for old places)
  description  text,
  people       jsonb not null default '[]',      -- person ids involved
  sources      jsonb not null default '[]',      -- [{title, url, quality: goc|loi_ke|suy_doan}]
  is_preferred boolean not null default true,
  alt_of       text references events (id),      -- an alternative value of another event (UI later)
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists events_person_idx on events (person_id);
create index if not exists events_family_idx on events (family_id);

-- stories: free text about a person. kind 'tom_tat' = the editable "Câu chuyện đời" summary (one per person).
create table if not exists stories (
  id          text primary key,                  -- S + 12 hex
  family_id   text not null references families (id),
  person_id   text not null references persons (id),
  kind        text not null default 'chuyen' check (kind in ('chuyen','tom_tat')),
  title       text not null default '',
  body        text not null default '',
  photos      jsonb not null default '[]',
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists stories_person_idx on stories (person_id);
