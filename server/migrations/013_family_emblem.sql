-- Family emblem (家紋 / seal / logo): one raster image per family (PNG, JPEG or WebP, <= 256 KB). Admin uploads.
-- Served by GET /api/families/:ref/emblem; families carry has_emblem + emblem_v (cache key) in their views.
create table if not exists family_emblems (
  family_id  text primary key references families(id) on delete cascade,
  mime       text not null,
  data       bytea not null,
  updated_at timestamptz not null default now()
);
