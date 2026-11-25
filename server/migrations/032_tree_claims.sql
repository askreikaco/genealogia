-- Nhận quản lý: a signed-in person asks to manage a tree with no active owner (or one whose owners are all inactive
-- for a year or deceased). status 'notice': the 30-day public notice runs (notice_until). Approval by an app admin
-- (GP_APP_ADMINS, server/claim-rules.js) only after the notice ends; then the claimant becomes an owner. Non-exclusive:
-- several claims may be open or approved for one tree. Reference trees (owner reference@giapha.invalid) count as unowned.
create table if not exists tree_claims (
  id              bigserial primary key,
  family_id       text not null references families (id),
  claimant_email  text not null,
  claimant_name   text not null default '',
  evidence        text not null default '',
  abandoned       boolean not null default false,
  status          text not null default 'notice' check (status in ('notice', 'approved', 'rejected', 'withdrawn')),
  notice_until    timestamptz not null,
  created_at      timestamptz not null default now(),
  decided_at      timestamptz,
  decided_by      text,
  decision_note   text not null default ''
);
create unique index if not exists tree_claims_open_uq on tree_claims (family_id, claimant_email) where status = 'notice';
create index if not exists tree_claims_status_idx on tree_claims (status, notice_until);
-- At most one optional file per claim (a small scan or photo, 700 KB; see claim-rules.js MAX_FILE_BYTES).
create table if not exists tree_claim_files (
  claim_id  bigint primary key references tree_claims (id) on delete cascade,
  name      text not null,
  mime      text not null,
  size      int not null,
  data      bytea not null
);
