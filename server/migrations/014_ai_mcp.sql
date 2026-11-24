-- AI connections (MCP, OAuth 2.1). Clients register themselves (RFC 7591); a consent in the app issues a code that
-- becomes a token bound to ONE family, one signed-in account (identity) and a set of scopes. Tokens and codes are stored
-- as sha256 hashes only. Revoking sets revoked_at (rows stay for the history). Idempotent.
create table if not exists ai_clients (
  client_id     text primary key,
  client_name   text not null,
  redirect_uris text[] not null,
  created_at    timestamptz not null default now()
);
-- Between /oauth/authorize and the consent page: the request waits here (its id is in a short httpOnly cookie).
create table if not exists ai_auth_requests (
  id             text primary key,
  client_id      text not null references ai_clients(client_id) on delete cascade,
  redirect_uri   text not null,
  code_challenge text not null,
  state          text,
  scopes        text[] not null,
  resource       text,
  expires_at     timestamptz not null
);
-- One-time authorization codes (10 minutes). Deleted when exchanged.
create table if not exists ai_codes (
  code_hash      text primary key,
  client_id      text not null references ai_clients(client_id) on delete cascade,
  redirect_uri   text not null,
  code_challenge text not null,
  family_id      text not null references families(id) on delete cascade,
  scopes         text[] not null,
  identity       jsonb not null,
  account_key    text not null,
  expires_at     timestamptz not null
);
create table if not exists ai_tokens (
  id                  serial primary key,
  token_hash          text unique not null,
  refresh_hash        text unique,
  client_id           text not null references ai_clients(client_id) on delete cascade,
  client_name         text not null,
  identity            jsonb not null,           -- { name, email? }: the signed-in account the token acts as
  account_key         text not null,            -- the account's key on the device (Settings lists by it)
  family_id           text not null references families(id) on delete cascade,
  scopes              text[] not null,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  refresh_expires_at  timestamptz,
  grant_id            text,                     -- one authorization = one grant; refresh rotation keeps it
  rotated_at          timestamptz,              -- set when this refresh token was used to rotate (reuse = theft signal)
  last_used_at        timestamptz,
  revoked_at          timestamptz
);
create index if not exists ai_tokens_grant_idx on ai_tokens (grant_id);
create index if not exists ai_tokens_account_idx on ai_tokens (account_key) where revoked_at is null;
-- A preview batch (dry run) of a set of changes; apply_changes writes it once. Expires after 24 hours.
create table if not exists ai_batches (
  id          text primary key,
  token_id    int not null references ai_tokens(id) on delete cascade,
  family_id   text not null references families(id) on delete cascade,
  status      text not null check (status in ('previewed', 'applied')),
  changes     jsonb not null,
  preview     jsonb not null,
  versions    jsonb not null,                   -- person id -> persons.version seen at preview (stale check on apply)
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  apply_op_id text,
  result      jsonb,
  applied_at  timestamptz
);
-- Sensitive admin actions asked by an AI: never run by the AI; an admin approves or rejects them in the app.
create table if not exists ai_requests (
  id           serial primary key,
  family_id    text not null references families(id) on delete cascade,
  token_id     int references ai_tokens(id) on delete set null,
  client_name  text not null,
  requested_by text not null,
  action       text not null check (action in ('invite_member', 'change_role', 'remove_member')),
  payload      jsonb not null,
  elicited     boolean not null default false,  -- the client asked the person to confirm (MCP elicitation) first
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  created_at   timestamptz not null default now(),
  decided_by   text,
  decided_at   timestamptz,
  reason       text
);
create index if not exists ai_requests_pending_idx on ai_requests (family_id, status);
