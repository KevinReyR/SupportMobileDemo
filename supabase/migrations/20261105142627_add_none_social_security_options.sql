insert into public.pension_funds (name, is_active)
values ('NINGUNA', true)
on conflict (name) do update
set is_active = excluded.is_active;

insert into public.health_insurers (name, is_active)
values ('NINGUNA', true)
on conflict (name) do update
set is_active = excluded.is_active;
