create or replace function public.get_client_contractor(
  p_contractor_id bigint
)
returns table (
  contractor_id bigint,
  first_name text,
  last_name text,
  document_number text,
  profile_photo_file_id uuid,
  birth_date date,
  rh text,
  civil_state text,
  eps text,
  arl text,
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
    c.profile_photo_file_id,
    c.birth_date,
    c.rh::text,
    cst.name::text,
    c.eps::text,
    c.arl::text,
    a.name::text,
    o.operation_date
  from public.contractor c
  join public.operation_assignment oa on oa.contractor_id = c.id
  join public.operation o on o.id = oa.operation_id
  join public.area a on a.id = o.area_id
  left join public.civil_state_type cst on cst.id = c.civil_state_id
  where c.id = p_contractor_id
    and public.has_role('CLIENT')
    and public.has_client_access(o.client_id)
    and oa.deleted_at is null
  order by c.id, o.operation_date desc, oa.id desc;
$$;

revoke execute on function public.get_client_contractor(bigint)
  from public, anon;
grant execute on function public.get_client_contractor(bigint)
  to authenticated;

notify pgrst, 'reload schema';
