drop function if exists public.get_client_contractors();

create or replace function public.get_client_contractors()
returns table (
  contractor_id bigint,
  first_name text,
  last_name text,
  document_number text,
  rh text,
  civil_state text,
  last_area text,
  last_operation_date date
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (c.id)
    c.id,
    c.name::text,
    c.last_name::text,
    c.document_number::text,
    c.rh::text,
    cst.name::text,
    a.name::text,
    o.operation_date
  from public.contractor c
  join public.operation_assignment oa on oa.contractor_id = c.id
  join public.operation o on o.id = oa.operation_id
  join public.area a on a.id = o.area_id
  left join public.civil_state_type cst on cst.id = c.civil_state_id
  where public.has_role('CLIENT')
    and public.has_client_access(o.client_id)
    and oa.deleted_at is null
  order by c.id, o.operation_date desc, oa.id desc;
$$;

create or replace function public.get_client_contractor_history(
  p_contractor_id bigint
)
returns table (
  assignment_id bigint,
  operation_date date,
  client_name text,
  area_name text,
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
    ats.name::text,
    oa.extra_hours
  from public.operation_assignment oa
  join public.operation o on o.id = oa.operation_id
  join public.clients cl on cl.id = o.client_id
  join public.area a on a.id = o.area_id
  left join public.attendance_status ats on ats.id = oa.attendance_status_id
  where oa.contractor_id = p_contractor_id
    and oa.deleted_at is null
    and public.has_role('CLIENT')
    and public.has_client_access(o.client_id)
  order by o.operation_date desc, oa.id desc;
$$;

revoke execute on function public.get_client_contractors() from public, anon;
revoke execute on function public.get_client_contractor_history(bigint) from public, anon;
grant execute on function public.get_client_contractors() to authenticated;
grant execute on function public.get_client_contractor_history(bigint) to authenticated;
