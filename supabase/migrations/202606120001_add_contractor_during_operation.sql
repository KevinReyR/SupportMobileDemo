create or replace function public.add_operation_contractor(
  p_operation_id bigint,
  p_contractor_id bigint
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  selected_service_id bigint;
  new_assignment_id bigint;
begin
  select cs.id
  into selected_service_id
  from public.operation o
  join public.client_services cs on cs.area_id = o.area_id
  where o.id = p_operation_id
    and o.status in ('EN_CURSO', 'CAMBIOS_SOLICITADOS')
    and public.has_role('COORDINATOR')
    and public.has_client_access(o.client_id)
  order by cs.id
  limit 1;

  if selected_service_id is null then
    raise exception 'Operation cannot receive contractors';
  end if;

  insert into public.operation_assignment(
    operation_id,
    contractor_id,
    client_service_id,
    planned_quantity,
    planned_by
  )
  values (
    p_operation_id,
    p_contractor_id,
    selected_service_id,
    1,
    auth.uid()
  )
  returning id into new_assignment_id;

  return new_assignment_id;
exception
  when unique_violation then
    raise exception 'Contractor is already assigned to this operation';
end;
$$;

revoke execute on function public.add_operation_contractor(bigint,bigint) from public, anon;
grant execute on function public.add_operation_contractor(bigint,bigint) to authenticated;
