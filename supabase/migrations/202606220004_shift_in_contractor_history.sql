-- Expose shift names in contractor operation history.

drop function if exists public.get_contractor_history(bigint);
drop function if exists public.get_client_contractor_history(bigint);

create or replace function public.get_contractor_history(p_contractor_id bigint)
returns table (
  assignment_id bigint,
  operation_date date,
  client_name text,
  area_name text,
  shift_name text,
  attendance_status text,
  extra_hours numeric,
  observations text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    oa.id,
    o.operation_date,
    cl.name,
    a.name,
    s.name,
    ats.name,
    oa.extra_hours,
    oa.observations
  from public.operation_assignment oa
  join public.operation o on o.id = oa.operation_id
  join public.clients cl on cl.id = o.client_id
  join public.area a on a.id = o.area_id
  join public.shift s on s.id = o.shift_id
  left join public.attendance_status ats on ats.id = oa.attendance_status_id
  where oa.contractor_id = p_contractor_id
    and oa.deleted_at is null
    and not public.has_role('CLIENT')
    and (
      public.has_role('DIRECTOR')
      or public.has_role('ADMIN')
      or (public.has_role('COORDINATOR') and public.has_client_access(o.client_id))
    )
  order by o.operation_date desc, oa.id desc;
$$;

create or replace function public.get_client_contractor_history(
  p_contractor_id bigint
)
returns table (
  assignment_id bigint,
  operation_date date,
  client_name text,
  area_name text,
  shift_name text,
  attendance_status text,
  extra_hours numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    oa.id,
    o.operation_date,
    cl.name::text,
    a.name::text,
    s.name::text,
    ats.name::text,
    oa.extra_hours
  from public.operation_assignment oa
  join public.operation o on o.id = oa.operation_id
  join public.clients cl on cl.id = o.client_id
  join public.area a on a.id = o.area_id
  join public.shift s on s.id = o.shift_id
  left join public.attendance_status ats on ats.id = oa.attendance_status_id
  where oa.contractor_id = p_contractor_id
    and oa.deleted_at is null
    and public.has_role('CLIENT')
    and public.has_client_access(o.client_id)
  order by o.operation_date desc, oa.id desc;
$$;

revoke execute on function public.get_contractor_history(bigint) from public, anon;
revoke execute on function public.get_client_contractor_history(bigint) from public, anon;
grant execute on function public.get_contractor_history(bigint) to authenticated;
grant execute on function public.get_client_contractor_history(bigint) to authenticated;

notify pgrst, 'reload schema';
