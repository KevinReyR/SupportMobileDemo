update public.service_unit_type
set name = 'Camión', updated_at = public.colombia_now()
where code = 'CAMION' and name is distinct from 'Camión';

create or replace function public.validate_financial_operation_type()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  expected_type_id bigint := case when tg_table_name = 'shift_sales' then 1 else 2 end;
begin
  if not exists (
    select 1 from public.operation o
    where o.id = new.operation_id and o.operation_type_id = expected_type_id
  ) then
    raise exception 'El registro financiero no corresponde al tipo de operacion';
  end if;
  return new;
end;
$$;

drop trigger if exists shift_sales_operation_type_guard on public.shift_sales;
create trigger shift_sales_operation_type_guard
before insert or update of operation_id on public.shift_sales
for each row execute function public.validate_financial_operation_type();

drop trigger if exists discharge_sales_operation_type_guard on public.discharge_sales;
create trigger discharge_sales_operation_type_guard
before insert or update of operation_id on public.discharge_sales
for each row execute function public.validate_financial_operation_type();

create or replace function public.get_discharge_client_attendance(
  p_start_date date,
  p_end_date date,
  p_client_id bigint default null,
  p_contractor_id bigint default null
)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select case when public.is_active_user() and public.has_role('DIRECTOR') then coalesce(jsonb_agg(
    jsonb_build_object('id', x.client_id, 'attendeeCount', x.attendee_count)
  ), '[]'::jsonb) else '[]'::jsonb end
  from (
    select o.client_id, count(*) filter (where coalesce(oa.worked_quantity, 0) > 0) attendee_count
    from public.operation o
    join public.operation_assignment oa on oa.operation_id = o.id and oa.deleted_at is null
    where o.operation_type_id = 2
      and o.operation_date between p_start_date and p_end_date
      and (p_client_id is null or o.client_id = p_client_id)
      and (p_contractor_id is null or oa.contractor_id = p_contractor_id)
    group by o.client_id
  ) x;
$$;

revoke execute on function public.get_discharge_client_attendance(date,date,bigint,bigint) from public, anon;
grant execute on function public.get_discharge_client_attendance(date,date,bigint,bigint) to authenticated;

notify pgrst, 'reload schema';
