-- Giỗ reminder e-mail (N1, gio-digest.js): an opt-in per account (default off) and the last weekly digest sent.
-- Additive, idempotent. down (manual): alter table user_prefs drop column if exists gio_digest, drop column if exists gio_digest_sent_at;
alter table user_prefs add column if not exists gio_digest boolean not null default false;
alter table user_prefs add column if not exists gio_digest_sent_at timestamptz;
