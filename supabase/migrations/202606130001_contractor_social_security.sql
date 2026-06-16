-- Contractor social security fields visible through the existing role scopes.

alter table public.contractor
  add column if not exists arl text;

update public.contractor
set arl = case (id - 1) % 4
  when 0 then 'Sura'
  when 1 then 'Positiva'
  when 2 then 'Colpatria'
  else 'Bolivar'
end
where id between 1 and 12
  and nullif(btrim(arl), '') is null;

drop function if exists public.get_client_contractors();

create function public.get_client_contractors()
returns table (
  contractor_id bigint,
  first_name text,
  last_name text,
  document_number text,
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
  where public.has_role('CLIENT')
    and public.has_client_access(o.client_id)
    and oa.deleted_at is null
  order by c.id, o.operation_date desc, oa.id desc;
$$;

revoke execute on function public.get_client_contractors() from public, anon;
grant execute on function public.get_client_contractors() to authenticated;
