-- Clan step 1. Thủy tổ, branch level, branch order and the short
-- name are worked out from the tree (web/js/branches.js, web/js/famlabel.js); these columns hold only the admin's
-- overrides (null = automatic), plus the quê gốc. Additive and idempotent.
alter table families add column if not exists short_name text;
alter table families add column if not exists founder_person_id text;
alter table families add column if not exists origin_place text;
alter table families add column if not exists branch_gen int;
alter table families add column if not exists branch_order jsonb;
