-- Report every contractor conflict before creating an operation.

create or replace function public.create_operation_with_assignments(
  p_operation_date date,
  p_client_id bigint,
  p_area_id bigint,
  p_shift_id bigint,
  p_assignments jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_operation_id bigint;
  selected_contractor_id bigint;
  selected_contractor_name text;
  target_client_name text;
  target_area_name text;
  target_shift_name text;
  rate_sale_price numeric;
  rate_cost_price numeric;
  conflict_details text;
begin
  if not public.has_role('COORDINATOR') or not public.has_client_access(p_client_id) then
    raise exception 'No tienes permisos para crear esta operacion';
  end if;

  if p_operation_date is null then
    raise exception 'La fecha de la operacion es obligatoria';
  end if;

  if p_assignments is null
    or jsonb_typeof(p_assignments) <> 'array'
    or jsonb_array_length(p_assignments) = 0 then
    raise exception 'Debes asignar al menos un contratista';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_assignments) assignment
    group by (assignment ->> 'contractor_id')
    having count(*) > 1
  ) then
    raise exception 'No puedes agregar el mismo contratista dos veces';
  end if;

  select cl.name, a.name, s.name
  into target_client_name, target_area_name, target_shift_name
  from public.clients cl
  join public.area a on a.client_id = cl.id and a.id = p_area_id
  join public.shift s on s.area_id = a.id and s.id = p_shift_id and s.is_active
  where cl.id = p_client_id;

  if target_shift_name is null then
    raise exception 'El turno seleccionado no pertenece al area';
  end if;

  select sale_price, cost_price
  into rate_sale_price, rate_cost_price
  from public.current_shift_rate(p_shift_id, p_operation_date);

  if rate_sale_price is null or rate_cost_price is null then
    raise exception 'La tarifa del turno no esta configurada';
  end if;

  if exists (
    select 1
    from public.operation o
    where o.operation_date = p_operation_date
      and o.client_id = p_client_id
      and o.area_id = p_area_id
      and o.shift_id = p_shift_id
  ) then
    raise exception 'Ya existe una operacion para % - % - % en esta fecha. Abre el detalle de la operacion existente para continuar.',
      coalesce(target_client_name, 'este cliente'),
      coalesce(target_area_name, 'esta area'),
      coalesce(target_shift_name, 'este turno');
  end if;

  for selected_contractor_id in
    select distinct (assignment ->> 'contractor_id')::bigint
    from jsonb_array_elements(p_assignments) assignment
    order by 1
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(
        'operation-assignment:' || p_operation_date::text || ':' || selected_contractor_id::text,
        0
      )
    );

    selected_contractor_name := coalesce(
      public.contractor_display_name(selected_contractor_id),
      'El contratista seleccionado'
    );

    if not public.contractor_has_active_contract(selected_contractor_id) then
      raise exception '% no tiene contrato activo y no puede asignarse a la operacion',
        selected_contractor_name;
    end if;
  end loop;

  with selected_contractors as (
    select distinct (assignment ->> 'contractor_id')::bigint as contractor_id
    from jsonb_array_elements(p_assignments) assignment
  ), conflicts as (
    select
      sc.contractor_id,
      coalesce(public.contractor_display_name(sc.contractor_id), 'El contratista seleccionado') as contractor_name,
      o.id as operation_id,
      case
        when public.has_client_access(o.client_id) then
          format(
            'Operacion #%s, %s - %s - %s',
            o.id,
            coalesce(cl.name, 'Cliente sin nombre'),
            coalesce(a.name, 'Area sin nombre'),
            case
              when ot.code = 'TURNO' then coalesce(s.name, 'Turno sin nombre')
              else coalesce(sut.name, 'Descargue')
            end
          )
        else 'otra operacion del dia'
      end as operation_detail
    from selected_contractors sc
    join public.operation_assignment oa
      on oa.contractor_id = sc.contractor_id
     and oa.deleted_at is null
    join public.operation o
      on o.id = oa.operation_id
     and o.operation_date = p_operation_date
    join public.operation_type ot on ot.id = o.operation_type_id
    left join public.clients cl on cl.id = o.client_id
    left join public.area a on a.id = o.area_id
    left join public.shift s on s.id = o.shift_id
    left join public.service_unit_type sut on sut.id = o.service_unit_type_id
  )
  select string_agg(
    format('%s (%s)', contractor_name, operation_detail),
    '; '
    order by contractor_name, operation_id
  )
  into conflict_details
  from conflicts;

  if conflict_details is not null then
    raise exception 'No se pudo guardar la operacion. Los siguientes contratistas ya estan asignados el %: %. Retiralos o cambia la fecha.',
      to_char(p_operation_date, 'DD/MM/YYYY'),
      conflict_details;
  end if;

  insert into public.operation(operation_date, client_id, area_id, shift_id, created_by, status)
  values (p_operation_date, p_client_id, p_area_id, p_shift_id, auth.uid(), 'EN_CURSO')
  returning id into new_operation_id;

  insert into public.operation_assignment(
    operation_id,
    contractor_id,
    planned_quantity,
    unit_sale_price,
    unit_cost_price,
    planned_by
  )
  select
    new_operation_id,
    (assignment ->> 'contractor_id')::bigint,
    coalesce((assignment ->> 'planned_quantity')::numeric, 1),
    rate_sale_price,
    rate_cost_price,
    auth.uid()
  from jsonb_array_elements(p_assignments) assignment;

  return new_operation_id;
exception
  when unique_violation then
    raise exception 'Ya existe una operacion para % - % - % en esta fecha. Abre el detalle de la operacion existente para continuar.',
      coalesce(target_client_name, 'este cliente'),
      coalesce(target_area_name, 'esta area'),
      coalesce(target_shift_name, 'este turno');
end;
$$;

revoke execute on function public.create_operation_with_assignments(date,bigint,bigint,bigint,jsonb)
  from public, anon;
grant execute on function public.create_operation_with_assignments(date,bigint,bigint,bigint,jsonb)
  to authenticated;

create or replace function public.create_discharge_operation_with_assignments(
  p_operation_date date,
  p_client_id bigint,
  p_area_id bigint,
  p_service_unit_type_id bigint,
  p_planned_units numeric,
  p_assignments jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_operation_id bigint;
  selected_contractor_id bigint;
  selected_contractor_name text;
  discharge_operation_type_id bigint;
  rate_sale_price numeric;
  rate_cost_price numeric;
  conflict_details text;
begin
  if not public.has_role('COORDINATOR') or not public.has_client_access(p_client_id) then
    raise exception 'No tienes permisos para crear esta operacion';
  end if;

  if p_operation_date is null then
    raise exception 'La fecha de la operacion es obligatoria';
  end if;

  if not exists (
    select 1
    from public.area a
    where a.id = p_area_id
      and a.client_id = p_client_id
      and a.is_active
  ) then
    raise exception 'El area seleccionada no pertenece al cliente';
  end if;

  if p_planned_units is null or p_planned_units <= 0 or p_planned_units <> round(p_planned_units, 2) then
    raise exception 'Las unidades planeadas deben ser positivas y tener maximo dos decimales';
  end if;

  if p_assignments is null
    or jsonb_typeof(p_assignments) <> 'array'
    or jsonb_array_length(p_assignments) = 0 then
    raise exception 'Debes asignar al menos un contratista';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_assignments) assignment
    group by (assignment ->> 'contractor_id')
    having count(*) > 1
  ) then
    raise exception 'No puedes agregar el mismo contratista dos veces';
  end if;

  select ot.id
  into discharge_operation_type_id
  from public.operation_type ot
  where ot.code = 'DESCARGUE'
    and ot.is_active;

  if discharge_operation_type_id is null then
    raise exception 'El tipo de operacion Descargue no esta configurado';
  end if;

  select sale_price, cost_price
  into rate_sale_price, rate_cost_price
  from public.current_service_unit_rate(p_area_id, p_service_unit_type_id, p_operation_date);

  if rate_sale_price is null or rate_cost_price is null then
    raise exception 'La tarifa del tipo de unidad no esta configurada para el area y la fecha';
  end if;

  for selected_contractor_id in
    select distinct (assignment ->> 'contractor_id')::bigint
    from jsonb_array_elements(p_assignments) assignment
    order by 1
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(
        'operation-assignment:' || p_operation_date::text || ':' || selected_contractor_id::text,
        0
      )
    );

    selected_contractor_name := coalesce(
      public.contractor_display_name(selected_contractor_id),
      'El contratista seleccionado'
    );

    if not public.contractor_has_active_contract(selected_contractor_id) then
      raise exception '% no tiene contrato activo y no puede asignarse a la operacion',
        selected_contractor_name;
    end if;
  end loop;

  with selected_contractors as (
    select distinct (assignment ->> 'contractor_id')::bigint as contractor_id
    from jsonb_array_elements(p_assignments) assignment
  ), conflicts as (
    select
      sc.contractor_id,
      coalesce(public.contractor_display_name(sc.contractor_id), 'El contratista seleccionado') as contractor_name,
      o.id as operation_id,
      case
        when public.has_client_access(o.client_id) then
          format(
            'Operacion #%s, %s - %s - %s',
            o.id,
            coalesce(cl.name, 'Cliente sin nombre'),
            coalesce(a.name, 'Area sin nombre'),
            coalesce(s.name, 'Turno sin nombre')
          )
        else 'otra operacion del dia'
      end as operation_detail
    from selected_contractors sc
    join public.operation_assignment oa
      on oa.contractor_id = sc.contractor_id
     and oa.deleted_at is null
    join public.operation o
      on o.id = oa.operation_id
     and o.operation_date = p_operation_date
    join public.operation_type ot
      on ot.id = o.operation_type_id
     and ot.code = 'TURNO'
    left join public.clients cl on cl.id = o.client_id
    left join public.area a on a.id = o.area_id
    left join public.shift s on s.id = o.shift_id
  )
  select string_agg(
    format('%s (%s)', contractor_name, operation_detail),
    '; '
    order by contractor_name, operation_id
  )
  into conflict_details
  from conflicts;

  if conflict_details is not null then
    raise exception 'No se pudo guardar la operacion. Los siguientes contratistas ya estan asignados el %: %. Retiralos o cambia la fecha.',
      to_char(p_operation_date, 'DD/MM/YYYY'),
      conflict_details;
  end if;

  insert into public.operation(
    operation_date,
    client_id,
    area_id,
    operation_type_id,
    shift_id,
    service_unit_type_id,
    planned_units,
    actual_units,
    unit_sale_price_snapshot,
    unit_cost_price_snapshot,
    created_by,
    status
  )
  values (
    p_operation_date,
    p_client_id,
    p_area_id,
    discharge_operation_type_id,
    null,
    p_service_unit_type_id,
    p_planned_units,
    null,
    rate_sale_price,
    rate_cost_price,
    auth.uid(),
    'EN_CURSO'
  )
  returning id into new_operation_id;

  insert into public.operation_assignment(
    operation_id,
    contractor_id,
    planned_quantity,
    extra_hours,
    unit_sale_price,
    unit_cost_price,
    planned_by
  )
  select
    new_operation_id,
    (assignment ->> 'contractor_id')::bigint,
    1,
    0,
    rate_sale_price,
    rate_cost_price,
    auth.uid()
  from jsonb_array_elements(p_assignments) assignment;

  return new_operation_id;
end;
$$;

revoke execute on function public.create_discharge_operation_with_assignments(date,bigint,bigint,bigint,numeric,jsonb)
  from public, anon;
grant execute on function public.create_discharge_operation_with_assignments(date,bigint,bigint,bigint,numeric,jsonb)
  to authenticated;

notify pgrst, 'reload schema';
