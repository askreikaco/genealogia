-- Accounts (account plan P1): one account with a stable id, many sign-in identities (verified emails, Google by its
-- stable user id; phone, Apple, Zalo, Facebook later), server-side sessions (device list, sign out one or all),
-- security events the owner of the account can read, and one-time tokens (email verification links, hashed).
-- Family roles stay on members.email for now: an account holds the roles of every one of its VERIFIED emails, and
-- members.account_id is filled as accounts appear (the app reads account_id first, then falls back to email).
create table if not exists accounts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default '',
  created_at  timestamptz not null default now(),
  merged_into uuid references accounts (id),
  deleted_at  timestamptz
);

-- type email: value_norm = lower-case address. type google: provider_sub = Google 'sub' (the key), value_norm = the
-- Google email at the last sign-in (display only, never used to find the account).
create table if not exists identities (
  id           bigserial primary key,
  account_id   uuid not null references accounts (id) on delete cascade,
  type         text not null check (type in ('email', 'phone', 'google', 'apple', 'zalo', 'facebook')),
  value_norm   text not null default '',
  provider_sub text,
  verified_at  timestamptz,
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
-- A provider account belongs to one account; a verified email or phone belongs to one account; an account lists an
-- address once; one primary email per account.
create unique index if not exists identities_provider_uq on identities (type, provider_sub) where provider_sub is not null;
create unique index if not exists identities_verified_uq on identities (type, value_norm) where verified_at is not null and provider_sub is null;
create unique index if not exists identities_own_uq on identities (account_id, type, value_norm) where provider_sub is null;
create unique index if not exists identities_primary_uq on identities (account_id) where is_primary;
create index if not exists identities_account_idx on identities (account_id);

-- One row per signed-in device and account. The cookie names the session id; a revoked row signs that device out.
create table if not exists sessions (
  id           text primary key,
  account_id   uuid not null references accounts (id) on delete cascade,
  label        text not null default '',
  ip_prefix    text not null default '',
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  auth_at      timestamptz not null default now(),
  revoked_at   timestamptz
);
create index if not exists sessions_account_idx on sessions (account_id, revoked_at);

-- Security activity of an account (Hoạt động bảo mật): sign-ins, methods added or removed, sessions revoked.
create table if not exists account_events (
  id         bigserial primary key,
  account_id uuid not null references accounts (id) on delete cascade,
  kind       text not null,
  detail     jsonb not null default '{}',
  ip_prefix  text not null default '',
  ua         text not null default '',
  at         timestamptz not null default now()
);
create index if not exists account_events_idx on account_events (account_id, at desc);

-- One-time tokens: only the sha256 of the token is stored. purpose 'email_verify': target = the address.
create table if not exists account_tokens (
  hash       text primary key,
  account_id uuid not null references accounts (id) on delete cascade,
  purpose    text not null,
  target     text not null,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

-- Account id beside the email keys (filled by scripts/accounts-backfill.js and on sign-in; email stays for display).
alter table members add column if not exists account_id uuid references accounts (id);
create index if not exists members_account_idx on members (account_id);
alter table person_managers add column if not exists account_id uuid references accounts (id);
alter table user_prefs add column if not exists account_id uuid references accounts (id);
alter table suggestions add column if not exists account_id uuid references accounts (id);
