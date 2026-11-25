-- Branch trees by reference (server/branch-routes.js): "Tạo cây cho nhánh này". A branch is a family row with
-- branch_home = the home tree and branch_root = the person it starts at. The branch stores no people: its persons are
-- read from the home tree, scope = branch_root + blood descendants + their spouses (derived per request). Additive, idempotent.
alter table families add column if not exists branch_home text references families (id);
alter table families add column if not exists branch_root text;
create index if not exists families_branch_home_idx on families (branch_home) where branch_home is not null;
