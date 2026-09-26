-- Materialize COSTO_TURNO directly from the effective shift rate.

alter table public.shift_costs
  drop constraint if exists shift_costs_calculation_type_check;

alter table public.shift_costs
  add constraint shift_costs_calculation_type_check check (
    calculation_type in (
      'FIXED_AMOUNT',
      'PERCENTAGE_OF_SALE',
      'PERCENTAGE_OF_BASE_COST',
      'DIRECT_EXTRA_HOUR',
      'DIRECT_SHIFT'
    )
  );

create or replace function public.materialize_direct_shift_costs(
  p_operation_id bigint,
  p_actor uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_operation record;
  target_rate record;
  direct_shift_concept_id bigint;
begin
  select o.id, o.operation_date, o.shift_id
  into target_operation
  from public.operation o
  join public.operation_type ot on ot.id = o.operation_type_id
  where o.id = p_operation_id
    and ot.code = 'TURNO';

  if target_operation.id is null then
    raise exception 'La operacion de turno no existe';
  end if;

  select rate.sale_price, rate.cost_price
  into target_rate
  from public.current_shift_rate(
    target_operation.shift_id,
    target_operation.operation_date
  ) rate;

  if target_rate.cost_price is null then
    raise exception 'El costo vigente del turno no esta configurado para la fecha de la operacion';
  end if;

  select cc.id
  into direct_shift_concept_id
  from public.cost_concepts cc
  where cc.code = 'COSTO_TURNO';

  if direct_shift_concept_id is null then
    raise exception 'El concepto COSTO_TURNO no esta configurado';
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
    direct_shift_concept_id,
    null,
    'DIRECT_SHIFT',
    target_rate.cost_price,
    coalesce(ss.worked_quantity, 0),
    coalesce(ss.extra_hours, 0),
    coalesce(ss.worked_quantity, 0) * coalesce(ss.unit_shift_sale_price, 0),
    coalesce(ss.worked_quantity, 0) * target_rate.cost_price,
    coalesce(ss.worked_quantity, 0) * target_rate.cost_price,
    'Costo directo del turno segun tarifa vigente',
    coalesce(p_actor, ss.created_by),
    coalesce(p_actor, ss.created_by)
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
  on conflict (shift_sale_id, cost_concept_id) do update set
    operation_id = excluded.operation_id,
    operation_assignment_id = excluded.operation_assignment_id,
    contractor_id = excluded.contractor_id,
    contract_type_id = excluded.contract_type_id,
    contract_type_cost_rule_id = null,
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
end;
$$;

revoke execute on function public.materialize_direct_shift_costs(bigint, uuid)
  from public, anon, authenticated;

-- Preserve the current approval implementation and wrap it with direct shift costs.
do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'review_operation_without_direct_shift'
  ) then
    alter function public.review_operation(bigint, varchar, text)
      rename to review_operation_without_direct_shift;
  end if;
end;
$$;

revoke execute on function public.review_operation_without_direct_shift(bigint, varchar, text)
  from public, anon, authenticated;

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
begin
  perform public.review_operation_without_direct_shift(
    p_operation_id,
    p_decision,
    p_observations
  );

  if p_decision = 'CERRADO' then
    perform public.materialize_direct_shift_costs(p_operation_id, auth.uid());
  end if;
end;
$$;

revoke execute on function public.review_operation(bigint, varchar, text)
  from public, anon;
grant execute on function public.review_operation(bigint, varchar, text)
  to authenticated;

-- Recalculate only COSTO_TURNO for already closed shift operations.
do $$
declare
  closed_operation record;
begin
  for closed_operation in
    select o.id
    from public.operation o
    join public.operation_type ot on ot.id = o.operation_type_id
    where ot.code = 'TURNO'
      and o.status = 'CERRADO'
    order by o.id
  loop
    perform public.materialize_direct_shift_costs(closed_operation.id, null);
  end loop;
end;
$$;

delete from public.contract_type_cost_rules rule
using public.cost_concepts concept
where concept.id = rule.cost_concept_id
  and concept.code = 'COSTO_TURNO';

create or replace function public.prevent_direct_shift_contract_rule()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.cost_concepts concept
    where concept.id = new.cost_concept_id
      and concept.code = 'COSTO_TURNO'
  ) then
    raise exception 'COSTO_TURNO se calcula directamente desde la tarifa vigente del turno';
  end if;

  return new;
end;
$$;

drop trigger if exists contract_type_cost_rules_prevent_direct_shift
  on public.contract_type_cost_rules;
create trigger contract_type_cost_rules_prevent_direct_shift
before insert or update on public.contract_type_cost_rules
for each row execute function public.prevent_direct_shift_contract_rule();

notify pgrst, 'reload schema';
