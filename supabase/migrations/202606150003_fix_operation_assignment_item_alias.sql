-- Fix ambiguous jsonb alias in initial operation registration.

create or replace function public.create_operation_with_assignments(
  p_operation_date date,
  p_client_id bigint,
  p_area_id bigint,
  p_assignments jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_operation_id bigint;
  assignment_item jsonb;
  selected_contractor_id bigint;
begin
  if not public.has_role('COORDINATOR') or not public.has_client_access(p_client_id) then
    raise exception 'Not authorized';
  end if;

  for assignment_item in select * from jsonb_array_elements(p_assignments)
  loop
    selected_contractor_id = (assignment_item ->> 'contractor_id')::bigint;

    if not public.contractor_has_active_contract(selected_contractor_id) then
      raise exception 'Contractor is not active';
    end if;

    if exists (
      select 1
      from public.operation_assignment oa
      join public.operation o on o.id = oa.operation_id
      where oa.contractor_id = selected_contractor_id
        and oa.deleted_at is null
        and o.operation_date = p_operation_date
    ) then
      raise exception 'Contractor % is already assigned to another operation on this date',
        selected_contractor_id;
    end if;
  end loop;

  insert into public.operation(operation_date, client_id, area_id, created_by, status)
  values (p_operation_date, p_client_id, p_area_id, auth.uid(), 'EN_CURSO')
  returning id into new_operation_id;

  insert into public.operation_assignment(
    operation_id,
    contractor_id,
    client_service_id,
    planned_quantity,
    planned_by
  )
  select
    new_operation_id,
    (payload ->> 'contractor_id')::bigint,
    (payload ->> 'client_service_id')::bigint,
    coalesce((payload ->> 'planned_quantity')::numeric, 1),
    auth.uid()
  from jsonb_array_elements(p_assignments) as payload;

  return new_operation_id;
end;
$$;

revoke execute on function public.create_operation_with_assignments(date,bigint,bigint,jsonb)
  from public, anon;
grant execute on function public.create_operation_with_assignments(date,bigint,bigint,jsonb)
  to authenticated;

notify pgrst, 'reload schema';
