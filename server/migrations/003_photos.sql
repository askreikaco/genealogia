-- Uploaded photos (resized JPEG in the browser, <= 600 KB). Person rows keep the URL in data.photo.
create table if not exists photos (
  id text primary key,
  mime text not null,
  bytes bytea not null,
  by_user text,
  at timestamptz not null default now()
);
