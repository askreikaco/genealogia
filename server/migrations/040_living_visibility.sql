-- P1d: how a living person shows to people outside the family (members always see everything).
-- families.living_visibility: the family setting, set by the owner or an admin ('private' = placeholder, 'names' = name only).
-- persons.self_visibility: the person's own setting ('inherit' follows the family). Only the linked account, its manager or a
-- device of that person may change it (elder-rules.js canSetSelfVisibility). Additive, idempotent.
-- down (manual): alter table persons drop column if exists self_visibility; alter table families drop column if exists living_visibility;
alter table families add column if not exists living_visibility text not null default 'private';
alter table families drop constraint if exists families_living_visibility_check;
alter table families add constraint families_living_visibility_check check (living_visibility in ('private', 'names'));
alter table persons add column if not exists self_visibility text not null default 'inherit';
alter table persons drop constraint if exists persons_self_visibility_check;
alter table persons add constraint persons_self_visibility_check check (self_visibility in ('inherit', 'private', 'names'));
