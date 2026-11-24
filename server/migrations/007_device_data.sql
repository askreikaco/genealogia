-- Device-held contributions and preferences (guests keep their data on the device; signing in syncs it).
-- Receipts: a random token per suggestion, given once to the sender; only its sha256 is stored.
-- account_email: set when a signed-in Google account sends or claims a suggestion.
-- notify_pending: an approve/reject with an email-like by_contact should notify the sender (sending not built yet).
alter table suggestions add column if not exists receipt_hash text;
alter table suggestions add column if not exists account_email text;
alter table suggestions add column if not exists notify_pending boolean not null default true;
alter table suggestions drop constraint if exists suggestions_status_check;
alter table suggestions add constraint suggestions_status_check check (status in ('pending', 'approved', 'rejected', 'withdrawn'));
create index if not exists suggestions_receipt_idx on suggestions (receipt_hash);
create index if not exists suggestions_account_idx on suggestions (account_email);
-- Per-account preferences (follows, theme, filters, recent searches). Size is capped by the API (16 KB).
create table if not exists user_prefs (
  email       text primary key,
  prefs       jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);
-- Per-field base: the value of each changed field when the suggestion was sent (or last edited by its sender).
-- Null = older row, base unknown. Used for the 3-way check at approve time (see /api/suggestions).
alter table suggestions add column if not exists base jsonb;
