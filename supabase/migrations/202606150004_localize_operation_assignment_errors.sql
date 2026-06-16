-- Return user-facing Spanish messages with contractor names in operation assignment RPCs.

create or replace function public.contractor_display_name(
  p_contractor_id bigint
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(trim(concat_ws(' ', c.name, c.last_name)), ''), 'Contratista')
  from public.contractor c
  where c.id = p_contractor_id;
$$;

revoke execute on function public.contractor_display_name(bigint) from public, anon;
grant execute on function public.contractor_display_name(bigint) to authenticated;

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
  selected_contractor_name text;
begin
  if not public.has_role('COORDINATOR') or not public.has_client_access(p_client_id) then
    raise exception 'No tienes permisos para crear esta operación';
  end if;

  for assignment_item in select * from jsonb_array_elements(p_assignments)
  loop
    selected_contractor_id = (assignment_item ->> 'contractor_id')::bigint;
    selected_contractor_name = coalesce(
      public.contractor_display_name(selected_contractor_id),
      'El contratista seleccionado'
    );

    if not public.contractor_has_active_contract(selected_contractor_id) then
      raise exception '% no tiene contrato activo y no puede asignarse a la operación',
        selected_contractor_name;
    end if;

    if exists (
      select 1
      from public.operation_assignment oa
      join public.operation o on o.id = oa.operation_id
      where oa.contractor_id = selected_contractor_id
        and oa.deleted_at is null
        and o.operation_date = p_operation_date
    ) then
      raise exception '% ya está asignado a otra operación en esta fecha',
        selected_contractor_name;
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
  assignment_item jsonb;
  target_date date;
  target_area_id bigint;
  selected_service_id bigint;
  selected_contractor_id bigint;
  selected_assignment_id bigint;
  selected_contractor_name text;
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
    raise exception 'La operación no se puede finalizar';
  end if;

  select cs.id
  into selected_service_id
  from public.client_services cs
  where cs.area_id = target_area_id
  order by cs.id
  limit 1;

  if selected_service_id is null then
    raise exception 'El servicio del área no está configurado';
  end if;

  for assignment_item in select * from jsonb_array_elements(p_assignments)
  loop
    selected_assignment_id = nullif(assignment_item ->> 'assignment_id', '')::bigint;
    selected_contractor_id = (assignment_item ->> 'contractor_id')::bigint;
    selected_contractor_name = coalesce(
      public.contractor_display_name(selected_contractor_id),
      'El contratista seleccionado'
    );

    if not public.contractor_has_active_contract(selected_contractor_id) then
      raise exception '% no tiene contrato activo y no puede asignarse a la operación',
        selected_contractor_name;
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
      raise exception '% ya está asignado a otra operación en esta fecha',
        selected_contractor_name;
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
        coalesce((assignment_item ->> 'worked_quantity')::numeric, 0),
        (assignment_item ->> 'attendance_status_id')::bigint,
        coalesce((assignment_item ->> 'extra_hours')::numeric, 0),
        nullif(assignment_item ->> 'observations', ''),
        auth.uid()
      );
    else
      update public.operation_assignment
      set attendance_status_id = (assignment_item ->> 'attendance_status_id')::bigint,
          worked_quantity = coalesce((assignment_item ->> 'worked_quantity')::numeric, 0),
          extra_hours = coalesce((assignment_item ->> 'extra_hours')::numeric, 0),
          observations = nullif(assignment_item ->> 'observations', ''),
          updated_at = now()
      where id = selected_assignment_id
        and contractor_id = selected_contractor_id
        and operation_id = p_operation_id;

      if not found then
        raise exception 'La asignación del contratista no es válida';
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

notify pgrst, 'reload schema';
