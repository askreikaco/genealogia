-- Country of a family tree (owner 2026-11-24): the "Quốc gia" level between the global clan and the trees. ISO 3166-1
-- alpha-2, optional; set by the family's owner/admin in Cài đặt dòng họ. No data is written here.
alter table families add column if not exists country text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'families_country_iso') then
    alter table families add constraint families_country_iso check (country is null or country ~ '^[A-Z]{2}$');
  end if;
end $$;
