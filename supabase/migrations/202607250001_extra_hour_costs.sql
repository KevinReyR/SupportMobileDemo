-- Add area-level extra-hour costs and materialize them during shift approval.

alter table public.area_extra_hour_rates
  add column if not exists cost_price numeric;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'area_extra_hour_rates_cost_price_nonnegative_check'
      and conrelid = 'public.area_extra_hour_rates'::regclass
  ) then
    alter table public.area_extra_hour_rates
      add constraint area_extra_hour_rates_cost_price_nonnegative_check
      check (cost_price is null or cost_price >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'area_extra_hour_rates_cost_price_required_check'
      and conrelid = 'public.area_extra_hour_rates'::regclass
  ) then
    alter table public.area_extra_hour_rates
      add constraint area_extra_hour_rates_cost_price_required_check
      check (cost_price is not null) not valid;
  end if;
end;
$$;

alter table public.operation_assignment
  add column if not exists unit_extra_hour_cost_price numeric;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'operation_assignment_extra_hour_cost_nonnegative_check'
      and conrelid = 'public.operation_assignment'::regclass
  ) then
    alter table public.operation_assignment
      add constraint operation_assignment_extra_hour_cost_nonnegative_check
      check (unit_extra_hour_cost_price is null or unit_extra_hour_cost_price >= 0);
  end if;
end;
$$;

insert into public.cost_concepts(code, name, description, category, status)
values (
  'COSTO_HORA_EXTRA',
  'Costo hora extra',
  'Costo directo por cada hora extra trabajada',
  'NOMINA',
  'ACTIVO'
)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  status = excluded.status,
  updated_at = public.colombia_now();

alter table public.shift_costs
  alter column contract_type_cost_rule_id drop not null;

alter table public.shift_costs
  drop constraint if exists shift_costs_calculation_type_check;

alter table public.shift_costs
  add constraint shift_costs_calculation_type_check check (
    calculation_type in (
      'DIRECT_EXTRA_HOUR',
      'FIXED_AMOUNT',
      'PERCENTAGE_OF_SALE',
      'PERCENTAGE_OF_BASE_COST'
    )
  );

drop function if exists public.current_area_extra_hour_rate(bigint, date);

create function public.current_area_extra_hour_rate(
  p_area_id bigint,
  p_operation_date date
)
returns table (
  sale_price numeric,
  cost_price numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select aehr.sale_price, aehr.cost_price
  from public.area_extra_hour_rates aehr
  where aehr.area_id = p_area_id
    and aehr.valid_from <= p_operation_date
    and (aehr.valid_to is null or aehr.valid_to >= p_operation_date)
  order by aehr.valid_from desc, aehr.id desc
  limit 1;
$$;

revoke execute on function public.current_area_extra_hour_rate(bigint, date)
  from public, anon;
grant execute on function public.current_area_extra_hour_rate(bigint, date)
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
  extra_hour_cost_price numeric;
begin
  select o.operation_date, o.area_id, o.shift_id
  into target_date, target_area_id, target_shift_id
  from public.operation o
  join public.operation_type ot on ot.id = o.operation_type_id
  where o.id = p_operation_id
    and ot.code = 'TURNO'
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

  select sale_price, cost_price
  into extra_hour_sale_price, extra_hour_cost_price
  from public.current_area_extra_hour_rate(target_area_id, target_date);

  if extra_hour_sale_price is null then
    raise exception 'El precio de venta de la hora extra del area no esta configurado';
  end if;

  if extra_hour_cost_price is null then
    raise exception 'El precio de costo de la hora extra del area no esta configurado';
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

    if selected_extra_hours < 0 then
      raise exception 'Las horas extra no pueden ser negativas';
    end if;

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
        unit_extra_hour_cost_price,
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
        extra_hour_cost_price,
        (selected_worked_quantity * rate_sale_price)
          + (selected_extra_hours * extra_hour_sale_price),
        (selected_worked_quantity * rate_cost_price)
          + (selected_extra_hours * extra_hour_cost_price),
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
          unit_extra_hour_cost_price = extra_hour_cost_price,
          total_sale = (selected_worked_quantity * rate_sale_price)
            + (selected_extra_hours * extra_hour_sale_price),
          total_cost = (selected_worked_quantity * rate_cost_price)
            + (selected_extra_hours * extra_hour_cost_price),
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

revoke execute on function public.finalize_operation(bigint, jsonb, text)
  from public, anon;
grant execute on function public.finalize_operation(bigint, jsonb, text)
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
  extra_hour_cost_price numeric;
  direct_extra_hour_concept_id bigint;
begin
  if not public.has_role('DIRECTOR') then
    raise exception 'Not authorized';
  end if;

  if p_decision not in ('CERRADO', 'CAMBIOS_SOLICITADOS') then
    raise exception 'Invalid decision';
  end if;

  if p_decision = 'CAMBIOS_SOLICITADOS'
    and nullif(trim(p_observations), '') is null then
    raise exception 'Review observations are required';
  end if;

  select o.id, o.operation_date, o.area_id
  into target_operation
  from public.operation o
  join public.operation_type ot on ot.id = o.operation_type_id
  where o.id = p_operation_id
    and ot.code = 'TURNO'
    and o.status = 'PENDIENTE'
  for update;

  if target_operation.id is null then
    raise exception 'Pending operation not found';
  end if;

  if p_decision = 'CERRADO' then
    select sale_price, cost_price
    into extra_hour_sale_price, extra_hour_cost_price
    from public.current_area_extra_hour_rate(
      target_operation.area_id,
      target_operation.operation_date
    );

    if extra_hour_sale_price is null then
      raise exception 'El precio de venta de la hora extra del area no esta configurado';
    end if;

    if extra_hour_cost_price is null then
      raise exception 'El precio de costo de la hora extra del area no esta configurado';
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

    select cc.id
    into direct_extra_hour_concept_id
    from public.cost_concepts cc
    where cc.code = 'COSTO_HORA_EXTRA';

    if direct_extra_hour_concept_id is null then
      raise exception 'El concepto de costo de hora extra no esta configurado';
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
      direct_extra_hour_concept_id,
      null,
      'DIRECT_EXTRA_HOUR',
      coalesce(oa.unit_extra_hour_cost_price, extra_hour_cost_price),
      ss.worked_quantity,
      ss.extra_hours,
      ss.extra_hours * ss.unit_extra_hour_sale_price,
      ss.extra_hours * coalesce(oa.unit_extra_hour_cost_price, extra_hour_cost_price),
      ss.extra_hours * coalesce(oa.unit_extra_hour_cost_price, extra_hour_cost_price),
      'Costo directo por horas extra',
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
    where ss.operation_id = p_operation_id
      and ss.extra_hours > 0
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
     and ctcr.cost_concept_id <> direct_extra_hour_concept_id
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

revoke execute on function public.review_operation(bigint, varchar, text)
  from public, anon;
grant execute on function public.review_operation(bigint, varchar, text)
  to authenticated;

notify pgrst, 'reload schema';
