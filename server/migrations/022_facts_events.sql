-- Profile facts become Dòng đời events (server/scripts/facts-to-events.js). CREATE/ALTER only, safe to re-run.
-- legacy_key: where a backfilled event came from: a profile field (burial, job, religion, place) or 'note:<hash>' for a
-- dated sentence of the note. NULL for events typed by people. One event per source per person (makes the backfill
-- idempotent). The profile fields themselves are never changed.
alter table events add column if not exists legacy_key text;
create unique index if not exists events_legacy_key_uidx on events (person_id, legacy_key) where legacy_key is not null;
