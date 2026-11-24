-- Succession groundwork (schema only; no endpoints or UI yet).
create table if not exists families (
  id                     text primary key,          -- 'duong'
  name                   text not null,
  han                    text,
  owner_inactive_months  int not null default 12
);
insert into families (id, name, han) values ('duong', 'Họ Dương', '楊') on conflict (id) do nothing;

create table if not exists trusted_contacts (
  id          serial primary key,
  family_id   text not null references families (id),
  email       text not null,
  name        text,
  status      text not null default 'invited' check (status in ('invited', 'accepted', 'declined', 'removed')),
  token_hash  text,
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  priority    int
);
create index if not exists trusted_contacts_family_idx on trusted_contacts (family_id, status);

create table if not exists handover_requests (
  id              serial primary key,
  family_id       text not null references families (id),
  kind            text not null check (kind in ('inactive', 'deceased', 'claim')),
  started_at      timestamptz not null default now(),
  deadline_at     timestamptz,
  status          text not null default 'open' check (status in ('open', 'cancelled', 'completed', 'blocked')),
  claimant_email  text,
  evidence        text,
  backers         jsonb not null default '[]',
  resolved_at     timestamptz,
  resolved_by     text
);
create index if not exists handover_requests_family_idx on handover_requests (family_id, status);
