-- Stable person ID (owner 2026-11-24): short_id = 6 characters + 1 check character from Crockford base32 without Z
-- (31 symbols, web/js/shortid.js).
-- Set by a trigger on every insert path (app, sheet sync, imports, seeds); existing people get one from
-- server/scripts/person-ids-backfill.js (dry run by default). Never changes once set.
alter table persons add column if not exists short_id text;
create unique index if not exists persons_short_id_key on persons (short_id) where short_id is not null;

create or replace function giapha_new_short_id() returns text language plpgsql volatile as $$
declare
  a constant text := '0123456789ABCDEFGHJKMNPQRSTVWXY';
  s text; v int; w int; i int;
begin
  loop
    s := ''; w := 0;
    for i in 1..6 loop
      v := floor(random() * 31)::int;
      s := s || substr(a, v + 1, 1);
      w := w + i * v;
    end loop;
    s := s || substr(a, (w % 31) + 1, 1);
    exit when not exists (select 1 from persons where short_id = s);
  end loop;
  return s;
end $$;

create or replace function persons_set_short_id() returns trigger language plpgsql as $$
begin
  if new.short_id is null then new.short_id := giapha_new_short_id(); end if;
  return new;
end $$;

drop trigger if exists persons_short_id on persons;
create trigger persons_short_id before insert on persons for each row execute function persons_set_short_id();
