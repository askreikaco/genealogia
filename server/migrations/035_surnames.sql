-- Surname over time (server/surname-rules.js). A person's names[] lives in persons.data (no table). The family keeps its
-- họ gốc (original surname, with Hán, the year of the change and a reason) and who may see it: all | members | editors.
-- Additive and idempotent.
alter table families add column if not exists origin_surname text;
alter table families add column if not exists origin_surname_han text;
alter table families add column if not exists origin_year text;
alter table families add column if not exists origin_reason text;
alter table families add column if not exists origin_visibility text not null default 'members';
alter table families drop constraint if exists families_origin_visibility_check;
alter table families add constraint families_origin_visibility_check check (origin_visibility in ('all', 'members', 'editors'));
