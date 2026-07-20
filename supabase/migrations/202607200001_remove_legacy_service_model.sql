-- Remove the legacy service dimension. Operations are priced by shift and area.

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
  assignment_item jsonb;
  selected_contractor_id bigint;
  selected_contractor_name text;
  target_client_name text;
  target_area_name text;
  target_shift_name text;
  rate_sale_price numeric;
  rate_cost_price numeric;
begin
  if not public.has_role('COORDINATOR') or not public.has_client_access(p_client_id) then
    raise exception 'No tienes permisos para crear esta operacion';
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
    (payload ->> 'contractor_id')::bigint,
    coalesce((payload ->> 'planned_quantity')::numeric, 1),
    rate_sale_price,
    rate_cost_price,
    auth.uid()
  from jsonb_array_elements(p_assignments) as payload;

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
  target_shift_id bigint;
  selected_contractor_id bigint;
  selected_assignment_id bigint;
  selected_contractor_name text;
  selected_worked_quantity numeric;
  selected_extra_hours numeric;
  rate_sale_price numeric;
  rate_cost_price numeric;
  extra_hour_sale_price numeric;
begin
  select o.operation_date, o.area_id, o.shift_id
  into target_date, target_area_id, target_shift_id
  from public.operation o
  where o.id = p_operation_id
    and o.status in ('EN_CURSO', 'CAMBIOS_SOLICITADOS')
    and public.has_role('COORDINATOR')
    and public.has_client_access(o.client_id)
  for update;

  if target_date is null then
    raise exception 'La operacion no se puede finalizar';
  end if;

  select sale_price, cost_price
  into rate_sale_price, rate_cost_price
  from public.current_shift_rate(target_shift_id, target_date);

  if rate_sale_price is null or rate_cost_price is null then
    raise exception 'La tarifa del turno no esta configurada';
  end if;

  select sale_price
  into extra_hour_sale_price
  from public.current_area_extra_hour_rate(target_area_id, target_date);

  if extra_hour_sale_price is null then
    raise exception 'La tarifa de hora extra del area no esta configurada';
  end if;

  for assignment_item in select * from jsonb_array_elements(p_assignments)
  loop
    selected_assignment_id = nullif(assignment_item ->> 'assignment_id', '')::bigint;
    selected_contractor_id = (assignment_item ->> 'contractor_id')::bigint;
    selected_worked_quantity = coalesce((assignment_item ->> 'worked_quantity')::numeric, 0);
    selected_extra_hours = coalesce((assignment_item ->> 'extra_hours')::numeric, 0);
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
        and o.operation_date = target_date
        and o.id <> p_operation_id
    ) then
      raise exception '% ya esta asignado a otra operacion en esta fecha',
        selected_contractor_name;
    end if;

    if selected_assignment_id is null then
      insert into public.operation_assignment(
        operation_id,
        contractor_id,
        planned_quantity,
        worked_quantity,
        attendance_status_id,
        extra_hours,
        unit_sale_price,
        unit_cost_price,
        total_sale,
        total_cost,
        observations,
        planned_by
      )
      values (
        p_operation_id,
        selected_contractor_id,
        1,
        selected_worked_quantity,
        (assignment_item ->> 'attendance_status_id')::bigint,
        selected_extra_hours,
        rate_sale_price,
        rate_cost_price,
        (selected_worked_quantity * rate_sale_price) + (selected_extra_hours * extra_hour_sale_price),
        selected_worked_quantity * rate_cost_price,
        nullif(assignment_item ->> 'observations', ''),
        auth.uid()
      );
    else
      update public.operation_assignment
      set attendance_status_id = (assignment_item ->> 'attendance_status_id')::bigint,
          worked_quantity = selected_worked_quantity,
          extra_hours = selected_extra_hours,
          unit_sale_price = rate_sale_price,
          unit_cost_price = rate_cost_price,
          total_sale = (selected_worked_quantity * rate_sale_price) + (selected_extra_hours * extra_hour_sale_price),
          total_cost = selected_worked_quantity * rate_cost_price,
          observations = nullif(assignment_item ->> 'observations', ''),
          updated_at = public.colombia_now()
      where id = selected_assignment_id
        and contractor_id = selected_contractor_id
        and operation_id = p_operation_id;

      if not found then
        raise exception 'La asignacion del contratista no es valida';
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

revoke execute on function public.finalize_operation(bigint,jsonb,text)
  from public, anon;
grant execute on function public.finalize_operation(bigint,jsonb,text)
  to authenticated;

create or replace function public.review_operation(
  p_operation_id bigint,
  p_decision varchar,
  p_observations text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_operation record;
  extra_hour_sale_price numeric;
begin
  if not public.has_role('DIRECTOR') then
    raise exception 'Not authorized';
  end if;
  if p_decision not in ('CERRADO', 'CAMBIOS_SOLICITADOS') then
    raise exception 'Invalid decision';
  end if;
  if p_decision = 'CAMBIOS_SOLICITADOS' and nullif(trim(p_observations), '') is null then
    raise exception 'Review observations are required';
  end if;

  select o.id, o.operation_date, o.area_id
  into target_operation
  from public.operation o
  where o.id = p_operation_id
    and o.status = 'PENDIENTE'
  for update;

  if target_operation.id is null then
    raise exception 'Pending operation not found';
  end if;

  if p_decision = 'CERRADO' then
    select sale_price
    into extra_hour_sale_price
    from public.current_area_extra_hour_rate(target_operation.area_id, target_operation.operation_date);

    if extra_hour_sale_price is null then
      raise exception 'La tarifa de hora extra del area no esta configurada';
    end if;

    insert into public.shift_sales(
      sale_at,
      operation_id,
      operation_assignment_id,
      contractor_id,
      worked_quantity,
      extra_hours,
      unit_shift_sale_price,
      unit_extra_hour_sale_price,
      total_sale,
      created_by
    )
    select
      public.colombia_now(),
      oa.operation_id,
      oa.id,
      oa.contractor_id,
      coalesce(oa.worked_quantity, 1),
      coalesce(oa.extra_hours, 0),
      coalesce(oa.unit_sale_price, 0),
      extra_hour_sale_price,
      (coalesce(oa.worked_quantity, 1) * coalesce(oa.unit_sale_price, 0))
        + (coalesce(oa.extra_hours, 0) * extra_hour_sale_price),
      auth.uid()
    from public.operation_assignment oa
    where oa.operation_id = p_operation_id
      and oa.deleted_at is null
    on conflict (operation_assignment_id) do update set
      sale_at = excluded.sale_at,
      operation_id = excluded.operation_id,
      contractor_id = excluded.contractor_id,
      worked_quantity = excluded.worked_quantity,
      extra_hours = excluded.extra_hours,
      unit_shift_sale_price = excluded.unit_shift_sale_price,
      unit_extra_hour_sale_price = excluded.unit_extra_hour_sale_price,
      total_sale = excluded.total_sale,
      created_by = excluded.created_by,
      updated_at = public.colombia_now();

    if exists (
      select 1
      from public.shift_sales ss
      where ss.operation_id = p_operation_id
        and not exists (
          select 1
          from public.contractor_contract cc
          where cc.contractor_id = ss.contractor_id
            and cc.start_date <= target_operation.operation_date
            and (cc.end_date is null or cc.end_date >= target_operation.operation_date)
        )
    ) then
      raise exception 'El contratista no tiene contrato vigente para la fecha de la operacion';
    end if;

    if exists (
      select 1
      from public.shift_sales ss
      join lateral (
        select cc.contract_type
        from public.contractor_contract cc
        where cc.contractor_id = ss.contractor_id
          and cc.start_date <= target_operation.operation_date
          and (cc.end_date is null or cc.end_date >= target_operation.operation_date)
        order by cc.start_date desc nulls last, cc.id desc
        limit 1
      ) current_contract on true
      where ss.operation_id = p_operation_id
        and not exists (
          select 1
          from public.contract_type_cost_rules ctcr
          where ctcr.contract_type_id = current_contract.contract_type
            and ctcr.status = 'ACTIVO'
            and ctcr.valid_from <= target_operation.operation_date
            and (ctcr.valid_to is null or ctcr.valid_to >= target_operation.operation_date)
        )
    ) then
      raise exception 'El tipo de contrato no tiene reglas de costo vigentes';
    end if;

    insert into public.shift_costs(
      cost_at,
      shift_sale_id,
      operation_id,
      operation_assignment_id,
      contractor_id,
      contract_type_id,
      cost_concept_id,
      contract_type_cost_rule_id,
      calculation_type,
      rule_value,
      worked_quantity,
      extra_hours,
      base_sale_amount,
      base_cost_amount,
      total_cost,
      notes,
      created_by,
      updated_by
    )
    select
      public.colombia_now(),
      ss.id,
      ss.operation_id,
      ss.operation_assignment_id,
      ss.contractor_id,
      current_contract.contract_type,
      ctcr.cost_concept_id,
      ctcr.id,
      ctcr.calculation_type,
      ctcr.value,
      ss.worked_quantity,
      ss.extra_hours,
      ss.total_sale,
      coalesce(oa.total_cost, 0),
      case ctcr.calculation_type
        when 'FIXED_AMOUNT' then ctcr.value * ss.worked_quantity
        when 'PERCENTAGE_OF_SALE' then ss.total_sale * ctcr.value / 100
        when 'PERCENTAGE_OF_BASE_COST' then coalesce(oa.total_cost, 0) * ctcr.value / 100
      end,
      'Calculado automaticamente',
      auth.uid(),
      auth.uid()
    from public.shift_sales ss
    join public.operation_assignment oa on oa.id = ss.operation_assignment_id
    join lateral (
      select cc.contract_type
      from public.contractor_contract cc
      where cc.contractor_id = ss.contractor_id
        and cc.start_date <= target_operation.operation_date
        and (cc.end_date is null or cc.end_date >= target_operation.operation_date)
      order by cc.start_date desc nulls last, cc.id desc
      limit 1
    ) current_contract on true
    join public.contract_type_cost_rules ctcr
      on ctcr.contract_type_id = current_contract.contract_type
     and ctcr.status = 'ACTIVO'
     and ctcr.valid_from <= target_operation.operation_date
     and (ctcr.valid_to is null or ctcr.valid_to >= target_operation.operation_date)
    where ss.operation_id = p_operation_id
    on conflict (shift_sale_id, cost_concept_id) do update set
      cost_at = excluded.cost_at,
      operation_id = excluded.operation_id,
      operation_assignment_id = excluded.operation_assignment_id,
      contractor_id = excluded.contractor_id,
      contract_type_id = excluded.contract_type_id,
      contract_type_cost_rule_id = excluded.contract_type_cost_rule_id,
      calculation_type = excluded.calculation_type,
      rule_value = excluded.rule_value,
      worked_quantity = excluded.worked_quantity,
      extra_hours = excluded.extra_hours,
      base_sale_amount = excluded.base_sale_amount,
      base_cost_amount = excluded.base_cost_amount,
      total_cost = excluded.total_cost,
      notes = excluded.notes,
      updated_by = excluded.updated_by,
      updated_at = public.colombia_now();
  end if;

  update public.operation
  set status = p_decision,
      review_observations = nullif(trim(p_observations), ''),
      verify_by = auth.uid(),
      verify_at = public.colombia_now(),
      closed_by = case when p_decision = 'CERRADO' then auth.uid() else null end,
      closed_at = case when p_decision = 'CERRADO' then public.colombia_now() else null end
  where id = p_operation_id
    and status = 'PENDIENTE';

  if not found then
    raise exception 'Pending operation not found';
  end if;
end;
$$;

revoke execute on function public.review_operation(bigint,varchar,text)
  from public, anon;
grant execute on function public.review_operation(bigint,varchar,text)
  to authenticated;

-- Dropping the columns also removes their owned foreign keys and indexes.
alter table public.operation_assignment
  drop column if exists client_service_id;

alter table public.shift_sales
  drop column if exists client_service_id;

drop policy if exists client_services_read on public.client_services;
drop policy if exists authenticated_read_service_catalog on public.service_catalog;
drop policy if exists authenticated_read_service_units on public.service_units;

drop table if exists public.client_services restrict;
drop table if exists public.service_catalog restrict;
drop table if exists public.service_units restrict;

notify pgrst, 'reload schema';
