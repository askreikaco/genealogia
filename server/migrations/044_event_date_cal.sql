-- Calendar of an event's other date (Lịch): the calendar the Âm lịch text was written in. Null = Vietnamese lunar.
-- Allowed values: cn-lunar, japanese, hebrew, islamic-umalqura (checked by cleanEvent in events.js).
-- Idempotent: ADD COLUMN IF NOT EXISTS.
alter table events add column if not exists date_cal text;
