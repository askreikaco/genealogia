-- Elder access (managed profiles, device sign-in by code, sign-in cards). Idempotent.
-- device_accounts: a sign-in on one device for one person (no email). Revoked or expired rows sign that device out.
create table if not exists device_accounts (
  id           text primary key,                -- 32 hex, held in the device's signed cookie
  family_id    text not null,
  person_id    text not null,                   -- the elder this device signs in as
  name         text not null default '',
  via          text not null default 'code' check (via in ('code', 'card')),
  device       text not null default '',         -- label from the user agent, e.g. 'iPhone · Safari'
  created_by   text,                            -- approver email (code) or null (card)
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  revoked_by   text,
  last_seen_at timestamptz
);
alter table device_accounts add column if not exists device text not null default '';
create index if not exists device_accounts_person_idx on device_accounts (family_id, person_id) where revoked_at is null;
-- person_managers: accounts (members with an email) who act for a managed person.
create table if not exists person_managers (
  family_id    text not null,
  person_id    text not null,
  email        text not null,
  added_by     text,
  added_at     timestamptz not null default now(),
  primary key (family_id, person_id, email)
);
-- device_codes: one sign-in request. Only the hash of the poll secret is stored; user_code is the 6-digit code shown.
create table if not exists device_codes (
  id           bigserial primary key,
  secret_hash  text unique not null,
  user_code    text not null,
  family_id    text,                            -- set by the first approval (the elder's family)
  person_id    text,                            -- set by the first approval
  approvals    int not null default 0,          -- 0, 1 (waiting for a second approver) or 2
  first_approver text,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'consumed')),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  consumed_at  timestamptz
);
create index if not exists device_codes_user_idx on device_codes (user_code) where status = 'pending';
-- sign_in_cards: printed card. Only the token hash is stored; one active card per person.
create table if not exists sign_in_cards (
  id           bigserial primary key,
  family_id    text not null,
  person_id    text not null,
  token_hash   text unique not null,
  created_by   text,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  revoked_by   text,
  uses         int not null default 0,
  last_used_at timestamptz
);
create unique index if not exists sign_in_cards_one_active on sign_in_cards (family_id, person_id) where revoked_at is null;
-- elder_log: who approved, who used a card, who signed a device out. No codes, tokens or secrets.
create table if not exists elder_log (
  id           bigserial primary key,
  created_at   timestamptz not null default now(),
  family_id    text not null,
  person_id    text,
  kind         text not null,
  actor        text,
  detail       text
);
create index if not exists elder_log_family_idx on elder_log (family_id, created_at desc);
-- Passkeys (WebAuthn, @simplewebauthn/server). account: 'g:<email>' (a Google account) or 'd:<device id>' (an elder device).
create table if not exists passkeys (
  id           bigserial primary key,
  cred_id      text unique not null,            -- base64url credential id
  public_key   bytea not null,
  counter      bigint not null default 0,
  transports   text[] not null default '{}',
  account      text not null,
  family_id    text not null,
  label        text not null default '',
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists passkeys_account_idx on passkeys (account);
-- One-time challenges for registration and sign-in (5 minutes, deleted when used).
create table if not exists passkey_challenges (
  id           text primary key,
  challenge    text not null,
  kind         text not null check (kind in ('reg', 'auth')),
  account      text,
  family_id    text,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null
);
