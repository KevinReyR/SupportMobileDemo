-- Remove legacy client_service_id from service rates now that rates belong to shifts.

do $$
begin
  if exists (
    select 1
    from public.service_rates sr
    where sr.shift_id is null
  ) then
    raise exception 'No se puede eliminar service_rates.client_service_id porque existen tarifas sin shift_id';
  end if;
end;
$$;

drop index if exists public.idx_service_rates_client_service_id;
drop index if exists public.idx_service_rates_validity;

alter table public.service_rates
  drop constraint if exists fk_service_rates_client_service;

alter table public.service_rates
  drop column if exists client_service_id;

alter table public.service_rates
  alter column shift_id set not null;

notify pgrst, 'reload schema';
