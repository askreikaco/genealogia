-- Photos on life events: the same shape as a story's photos (a list of photo links). Idempotent.
-- A link is an http(s) URL or an uploaded photo path (/api/photos/<24 hex>). Visibility = the person's events (see events.js).
alter table events add column if not exists photos jsonb not null default '[]';
