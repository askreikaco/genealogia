-- Outgoing mail (Brevo, see server/mail.js). One row per send attempt. Never holds the API key or the message body.
-- dedupe_key: a notice or reminder that is already 'sent' is not sent again (checked in code, not by a unique key,
-- so a 'skipped' or 'failed' attempt can be retried later).
create table if not exists mail_log (
  id           bigserial primary key,
  created_at   timestamptz not null default now(),
  family_id    text,
  kind         text not null,
  to_email     text not null,
  subject      text not null,
  status       text not null,
  provider_id  text,
  error        text,
  dedupe_key   text
);
create index if not exists mail_log_family_idx on mail_log (family_id, created_at desc);
create index if not exists mail_log_dedupe_idx on mail_log (dedupe_key);
