-- Return a clear Spanish message when an initial operation already exists.

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
  target_client_name text;
  target_area_name text;
begin
  if not public.has_role('COORDINATOR') or not public.has_client_access(p_client_id) then
    raise exception 'No tienes permisos para crear esta operacion';
  end if;

  select cl.name, a.name
  into target_client_name, target_area_name
  from public.clients cl
  join public.area a on a.id = p_area_id
  where cl.id = p_client_id;

  if exists (
    select 1
    from public.operation o
    where o.operation_date = p_operation_date
      and o.client_id = p_client_id
      and o.area_id = p_area_id
  ) then
    raise exception 'Ya existe una operacion para % - % en esta fecha. Abre el detalle de la operacion existente para continuar.',
      coalesce(target_client_name, 'este cliente'),
      coalesce(target_area_name, 'esta area');
  end if;

  for assignment_item in select * from jsonb_array_elements(p_assignments)
  loop
    selected_contractor_id = (assignment_item ->> 'contractor_id')::bigint;
    selected_contractor_name = coalesce(
      public.contractor_display_name(selected_contractor_id),
      'El contratista seleccionado'
    );

    if not public.contractor_has_active_contract(selected_contractor_id) then
      raise exception '% no tiene contrato activo y no puede asignarse a la operacion',
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
      raise exception '% ya esta asignado a otra operacion en esta fecha',
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
exception
  when unique_violation then
    raise exception 'Ya existe una operacion para % - % en esta fecha. Abre el detalle de la operacion existente para continuar.',
      coalesce(target_client_name, 'este cliente'),
      coalesce(target_area_name, 'esta area');
end;
$$;

revoke execute on function public.create_operation_with_assignments(date,bigint,bigint,jsonb)
  from public, anon;
grant execute on function public.create_operation_with_assignments(date,bigint,bigint,jsonb)
  to authenticated;

notify pgrst, 'reload schema';
