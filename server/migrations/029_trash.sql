-- Thùng rác (owner 2026-11-24: "historical data is precious"). Every delete keeps the rows it removed here, so it can be
-- restored: GP_TRASH_DAYS (default 30) days in the trash (anyone who could delete it restores), then it moves to the archive
-- (owner/admin restore). The archive keeps historical data forever; a living person's events, stories and persons are purged
-- there GP_ARCHIVE_LIVING_DAYS (365) days after archiving, only with GP_TRASH_PURGE=1 (otherwise the sweep logs). See server/trash.js.
-- state: pending (a person delete waiting for a second owner/admin, or for due_at in a one-admin family),
--        trash, archive, restored, purged, rejected, cancelled.
create table if not exists trash (
  id            bigserial primary key,
  family_id     text not null,
  kind          text not null check (kind in ('person', 'event', 'story', 'parent_child', 'couple', 'place_link', 'person_link')),
  item_id       text not null,
  person_id     text,
  label         text not null default '',
  reason        text,
  payload       jsonb,
  state         text not null default 'trash' check (state in ('pending', 'trash', 'archive', 'restored', 'purged', 'rejected', 'cancelled')),
  impact        jsonb,
  requested_by  text, requested_key text, requested_at timestamptz not null default now(),
  due_at        timestamptz,
  deleted_by    text, deleted_key text, deleted_at timestamptz,
  decided_by    text, decided_at timestamptz,
  archived_by   text, archived_at timestamptz,
  restored_by   text, restored_at timestamptz,
  purged_by     text, purged_at timestamptz,
  -- when the warnings 30 and 7 days before a living person's purge were sent (once each; see warnDue in trash.js)
  warned_30     timestamptz, warned_7 timestamptz
);
create index if not exists trash_family_state_idx on trash (family_id, state, deleted_at desc);
create index if not exists trash_deleted_key_idx on trash (deleted_key, deleted_at);
create index if not exists trash_requested_key_idx on trash (requested_key, requested_at);
-- Refused deletes (brake) and other trash actions worth an audit line.
create table if not exists trash_audit (
  id         bigserial primary key,
  family_id  text,
  actor_key  text,
  action     text not null,
  detail     jsonb,
  at         timestamptz not null default now()
);
-- In-app notices (a badge when mail is not set up): a person deleted / restored, a delete waiting for approval.
create table if not exists notices (
  id          bigserial primary key,
  email       text not null,
  family_id   text,
  kind        text not null,
  body        text not null,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index if not exists notices_email_idx on notices (email, read_at);
