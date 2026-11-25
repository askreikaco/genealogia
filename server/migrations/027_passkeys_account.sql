-- Passkeys belong to the account (Tài khoản › Cách đăng nhập), not to an email string: account_id is the owner, so a
-- passkey stays listed and counted when the email that named it is removed. The old key ('g:<email>') still signs in.
-- Data-changing: fills account_id on existing rows from the verified email (or Google) identity that has the same address.
-- Idempotent: a row that already has an account is left alone.
alter table passkeys add column if not exists account_id uuid references accounts (id) on delete cascade;
update passkeys p set account_id = x.account_id
  from (
    select distinct on (pk.id) pk.id, i.account_id
      from passkeys pk
      join identities i on i.value_norm = substr(pk.account, 3) and i.type in ('email', 'google')
     where pk.account_id is null and pk.account like 'g:%'
     order by pk.id, (i.type = 'email' and i.verified_at is not null) desc, i.id
  ) x
 where p.id = x.id;
create index if not exists passkeys_account_id_idx on passkeys (account_id);
