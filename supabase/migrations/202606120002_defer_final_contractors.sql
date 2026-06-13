drop function if exists public.add_operation_contractor(bigint,bigint);

create or replace function public.get_available_contractors_for_operation(
  p_operation_id bigint
)
returns table(contractor_id bigint)
language sql
security definer
set search_path = public
stable
as $$
  select c.id
  from public.contractor c
  join public.operation target on target.id = p_operation_id
  where public.has_role('COORDINATOR')
    and public.has_client_access(target.client_id)
    and target.status in ('EN_CURSO', 'CAMBIOS_SOLICITADOS')
    and c.termination_date is null
    and not exists (
      select 1
      from public.operation_assignment oa
      join public.operation o on o.id = oa.operation_id
      where oa.contractor_id = c.id
        and oa.deleted_at is null
        and o.operation_date = target.operation_date
        and o.id <> target.id
    )
  order by c.name, c.last_name;
$$;

revoke execute on function public.get_available_contractors_for_operation(bigint) from public, anon;
grant execute on function public.get_available_contractors_for_operation(bigint) to authenticated;

create or replace function public.finalize_operation(
  p_operation_id bigint,
  p_assignments jsonb,
  p_observations text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  target_date date;
  target_area_id bigint;
  selected_service_id bigint;
  selected_contractor_id bigint;
  selected_assignment_id bigint;
begin
  select o.operation_date, o.area_id
  into target_date, target_area_id
  from public.operation o
  where o.id = p_operation_id
    and o.status in ('EN_CURSO', 'CAMBIOS_SOLICITADOS')
    and public.has_role('COORDINATOR')
    and public.has_client_access(o.client_id)
  for update;

  if target_date is null then
    raise exception 'Operation cannot be finalized';
  end if;

  select cs.id
  into selected_service_id
  from public.client_services cs
  where cs.area_id = target_area_id
  order by cs.id
  limit 1;

  if selected_service_id is null then
    raise exception 'Operation service is not configured';
  end if;

  for item in select * from jsonb_array_elements(p_assignments)
  loop
    selected_assignment_id = nullif(item ->> 'assignment_id', '')::bigint;
    selected_contractor_id = (item ->> 'contractor_id')::bigint;

    perform 1
    from public.contractor c
    where c.id = selected_contractor_id
      and c.termination_date is null
    for update;

    if not found then
      raise exception 'Contractor is not active';
    end if;

    if exists (
      select 1
      from public.operation_assignment oa
      join public.operation o on o.id = oa.operation_id
      where oa.contractor_id = selected_contractor_id
        and oa.deleted_at is null
        and o.operation_date = target_date
        and o.id <> p_operation_id
    ) then
      raise exception 'Contractor % is already assigned to another operation on this date',
        selected_contractor_id;
    end if;

    if selected_assignment_id is null then
      insert into public.operation_assignment(
        operation_id,
        contractor_id,
        client_service_id,
        planned_quantity,
        worked_quantity,
        attendance_status_id,
        extra_hours,
        observations,
        planned_by
      )
      values (
        p_operation_id,
        selected_contractor_id,
        selected_service_id,
        1,
        coalesce((item ->> 'worked_quantity')::numeric, 0),
        (item ->> 'attendance_status_id')::bigint,
        coalesce((item ->> 'extra_hours')::numeric, 0),
        nullif(item ->> 'observations', ''),
        auth.uid()
      );
    else
      update public.operation_assignment
      set attendance_status_id = (item ->> 'attendance_status_id')::bigint,
          worked_quantity = coalesce((item ->> 'worked_quantity')::numeric, 0),
          extra_hours = coalesce((item ->> 'extra_hours')::numeric, 0),
          observations = nullif(item ->> 'observations', ''),
          updated_at = now()
      where id = selected_assignment_id
        and contractor_id = selected_contractor_id
        and operation_id = p_operation_id;

      if not found then
        raise exception 'Invalid operation assignment';
      end if;
    end if;
  end loop;

  update public.operation
  set status = 'PENDIENTE',
      observations = p_observations,
      review_observations = null,
      verify_by = null,
      verify_at = null
  where id = p_operation_id;
end;
$$;

revoke execute on function public.finalize_operation(bigint,jsonb,text) from public, anon;
grant execute on function public.finalize_operation(bigint,jsonb,text) to authenticated;
