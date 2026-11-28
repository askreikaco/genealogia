-- Custom event name (Khác): a short name for an event of type 'khac', like GEDCOM EVEN + TYPE (gedcom.js).
-- Stored for any type; the UI shows it for 'khac' only. Max 80 characters, checked by the rules (events.js).
-- Idempotent: ADD COLUMN IF NOT EXISTS.
alter table events add column if not exists title text;
