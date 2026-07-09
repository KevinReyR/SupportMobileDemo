-- Admin management permissions for mixed mobile/web administration.

alter table public.workwear_type
  add column if not exists is_active boolean not null default true;

alter table public.cost_concepts
  add column if not exists status text not null default 'ACTIVO';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'cost_concepts_status_check'
      and conrelid = 'public.cost_concepts'::regclass
  ) then
    alter table public.cost_concepts
      add constraint cost_concepts_status_check
      check (status in ('ACTIVO', 'INACTIVO'));
  end if;
end;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('ADMIN');
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

drop policy if exists clients_admin_insert on public.clients;
create policy clients_admin_insert on public.clients
for insert to authenticated
with check (public.is_admin());

drop policy if exists clients_admin_update on public.clients;
create policy clients_admin_update on public.clients
for update to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists area_admin_insert on public.area;
create policy area_admin_insert on public.area
for insert to authenticated
with check (public.is_admin());

drop policy if exists area_admin_update on public.area;
create policy area_admin_update on public.area
for update to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists shift_admin_insert on public.shift;
create policy shift_admin_insert on public.shift
for insert to authenticated
with check (public.is_admin());

drop policy if exists shift_admin_update on public.shift;
create policy shift_admin_update on public.shift
for update to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists contractor_admin_update on public.contractor;
create policy contractor_admin_update on public.contractor
for update to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists contractor_contract_admin_insert on public.contractor_contract;
create policy contractor_contract_admin_insert on public.contractor_contract
for insert to authenticated
with check (public.is_admin());

drop policy if exists contractor_contract_admin_update on public.contractor_contract;
create policy contractor_contract_admin_update on public.contractor_contract
for update to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists service_rates_admin_insert on public.service_rates;
create policy service_rates_admin_insert on public.service_rates
for insert to authenticated
with check (public.is_admin());

drop policy if exists service_rates_admin_update on public.service_rates;
create policy service_rates_admin_update on public.service_rates
for update to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists area_extra_hour_rates_admin_insert on public.area_extra_hour_rates;
create policy area_extra_hour_rates_admin_insert on public.area_extra_hour_rates
for insert to authenticated
with check (public.is_admin());

drop policy if exists area_extra_hour_rates_admin_update on public.area_extra_hour_rates;
create policy area_extra_hour_rates_admin_update on public.area_extra_hour_rates
for update to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists cost_concepts_admin_insert on public.cost_concepts;
create policy cost_concepts_admin_insert on public.cost_concepts
for insert to authenticated
with check (public.is_admin());

drop policy if exists cost_concepts_admin_update on public.cost_concepts;
create policy cost_concepts_admin_update on public.cost_concepts
for update to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists contract_type_cost_rules_admin_insert on public.contract_type_cost_rules;
create policy contract_type_cost_rules_admin_insert on public.contract_type_cost_rules
for insert to authenticated
with check (public.is_admin());

drop policy if exists contract_type_cost_rules_admin_update on public.contract_type_cost_rules;
create policy contract_type_cost_rules_admin_update on public.contract_type_cost_rules
for update to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists workwear_type_admin_insert on public.workwear_type;
create policy workwear_type_admin_insert on public.workwear_type
for insert to authenticated
with check (public.is_admin());

drop policy if exists workwear_type_admin_update on public.workwear_type;
create policy workwear_type_admin_update on public.workwear_type
for update to authenticated
using (public.is_admin())
with check (public.is_admin());

grant insert, update on public.clients to authenticated;
grant insert, update on public.area to authenticated;
grant insert, update on public.shift to authenticated;
grant insert, update on public.contractor to authenticated;
grant insert, update on public.contractor_contract to authenticated;
grant insert, update on public.service_rates to authenticated;
grant insert, update on public.area_extra_hour_rates to authenticated;
grant insert, update on public.cost_concepts to authenticated;
grant insert, update on public.contract_type_cost_rules to authenticated;
grant insert, update on public.workwear_type to authenticated;

do $$
declare
  sequence_name text;
begin
  foreach sequence_name in array array[
    'clients_id_seq',
    'area_id_seq',
    'shift_id_seq',
    'contractor_contract_id_seq',
    'service_rates_id_seq',
    'area_extra_hour_rates_id_seq',
    'cost_concepts_id_seq',
    'contract_type_cost_rules_id_seq',
    'workwear_type_id_seq'
  ]
  loop
    if to_regclass('public.' || sequence_name) is not null then
      execute format('grant usage, select on sequence public.%I to authenticated', sequence_name);
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
