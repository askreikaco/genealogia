-- Two-step sign-in (TOTP, RFC 6238) and recovery codes (Tài khoản › Bảo mật). One authenticator per account.
-- secret_enc: the base32 secret sealed with AES-256-GCM (key derived from SESSION_SECRET; totp-rules.js). A row with
-- enabled = false is an enrollment in progress: it signs nobody in until one code is confirmed.
-- last_step: the last 30 s step that signed in (or confirmed), so one code works once. fail_count/fail_at: failed code
-- attempts in the current 10-minute window (5 per window; the window starts at the first failure).
create table if not exists totp_factors (
  account_id uuid primary key references accounts (id) on delete cascade,
  secret_enc text not null,
  enabled    boolean not null default false,
  last_step  bigint not null default 0,
  fail_count integer not null default 0,
  fail_at    timestamptz,
  created_at timestamptz not null default now(),
  enabled_at timestamptz
);

-- Recovery codes: only a salted scrypt hash is stored; a code is used once (used_at).
create table if not exists recovery_codes (
  id         bigserial primary key,
  account_id uuid not null references accounts (id) on delete cascade,
  code_hash  text not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists recovery_codes_account_idx on recovery_codes (account_id, used_at);

-- Second step of a sign-in in progress (after Google, before the session exists). id = sha256 of the cookie token.
-- mode '' = sign-in; 'reauth' = a fresh sign-in for a sensitive change (sid: the session it renews). Five minutes.
create table if not exists login_2fa (
  id         text primary key,
  account_id uuid not null references accounts (id) on delete cascade,
  mode       text not null default '',
  sid        text not null default '',
  payload    jsonb not null default '{}',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists login_2fa_expires_idx on login_2fa (expires_at);
