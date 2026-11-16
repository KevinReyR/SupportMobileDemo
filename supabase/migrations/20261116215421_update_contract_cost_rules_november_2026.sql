-- Update the daily contract costs effective on 2026-11-01 and rematerialize
-- only the affected concepts for operations that are already closed.

set local lock_timeout = '5s';
set local statement_timeout = '120s';

select pg_advisory_xact_lock(hashtextextended('contract_type_cost_rules:2026-11-01', 0));

create temporary table desired_contract_cost_rules (
  contract_type_name text not null,
  concept_code text not null,
  daily_value numeric(14, 2) not null,
  primary key (contract_type_name, concept_code)
) on commit drop;

insert into desired_contract_cost_rules(contract_type_name, concept_code, daily_value) values
  ('SOLO ARL', 'ARL', 3260.00),
  ('PAQUETE COMPLETO', 'EPS', 7296.67),
  ('PAQUETE COMPLETO', 'ARL', 2540.00),
  ('PAQUETE COMPLETO', 'PENSION', 9340.00),
  ('DIRECTO', 'EPS', 2336.67),
  ('DIRECTO', 'ARL', 1404.67),
  ('DIRECTO', 'CCF', 2066.67),
  ('DIRECTO', 'PENSION', 9340.00),
  ('DIRECTO', 'CESANTIAS', 7810.53),
  ('DIRECTO', 'INTERES_CESANTIAS', 937.63),
  ('DIRECTO', 'VACACIONES', 2433.43),
  ('DIRECTO', 'PRIMA', 7810.53);

do $migration_checks$
declare
  resolved_rule_count integer;
begin
  select count(*)
  into resolved_rule_count
  from desired_contract_cost_rules desired
  join public.contract_type contract_type
    on upper(contract_type.name) = desired.contract_type_name
  join public.cost_concepts concept
    on concept.code = desired.concept_code;

  if resolved_rule_count <> 12 then
    raise exception
      'Expected to resolve 12 contract cost rules, but resolved %',
      resolved_rule_count;
  end if;

  if exists (
    select 1
    from public.contract_type_cost_rules rule
    join public.contract_type contract_type on contract_type.id = rule.contract_type_id
    join public.cost_concepts concept on concept.id = rule.cost_concept_id
    join desired_contract_cost_rules desired
      on desired.contract_type_name = upper(contract_type.name)
     and desired.concept_code = concept.code
    where rule.status = 'ACTIVO'
      and rule.valid_from > date '2026-11-01'
  ) then
    raise exception
      'A later active rule already exists for one of the costs effective on 2026-11-01';
  end if;
end;
$migration_checks$;

-- End the previous versions without deactivating them: their ACTIVO status is
-- required for historical lookups within their now-closed validity period.
update public.contract_type_cost_rules rule
set valid_to = date '2026-10-31',
    updated_at = public.colombia_now()
from public.contract_type contract_type,
     public.cost_concepts concept,
     desired_contract_cost_rules desired
where contract_type.id = rule.contract_type_id
  and concept.id = rule.cost_concept_id
  and desired.contract_type_name = upper(contract_type.name)
  and desired.concept_code = concept.code
  and rule.status = 'ACTIVO'
  and rule.valid_from < date '2026-11-01'
  and (rule.valid_to is null or rule.valid_to >= date '2026-11-01');

-- Make a rerun safe if the 2026-11-01 version was created before the entire
-- migration completed.
update public.contract_type_cost_rules rule
set calculation_type = 'FIXED_AMOUNT',
    value = desired.daily_value,
    valid_to = null,
    status = 'ACTIVO',
    updated_at = public.colombia_now()
from public.contract_type contract_type,
     public.cost_concepts concept,
     desired_contract_cost_rules desired
where contract_type.id = rule.contract_type_id
  and concept.id = rule.cost_concept_id
  and desired.contract_type_name = upper(contract_type.name)
  and desired.concept_code = concept.code
  and rule.valid_from = date '2026-11-01';

insert into public.contract_type_cost_rules(
  contract_type_id,
  cost_concept_id,
  calculation_type,
  value,
  valid_from,
  valid_to,
  status
)
select
  contract_type.id,
  concept.id,
  'FIXED_AMOUNT',
  desired.daily_value,
  date '2026-11-01',
  null,
  'ACTIVO'
from desired_contract_cost_rules desired
join public.contract_type contract_type
  on upper(contract_type.name) = desired.contract_type_name
join public.cost_concepts concept
  on concept.code = desired.concept_code
where not exists (
  select 1
  from public.contract_type_cost_rules existing
  where existing.contract_type_id = contract_type.id
    and existing.cost_concept_id = concept.id
    and existing.valid_from = date '2026-11-01'
);

create temporary table new_contract_cost_rules on commit drop as
select
  rule.id,
  rule.contract_type_id,
  rule.cost_concept_id,
  rule.value
from public.contract_type_cost_rules rule
join public.contract_type contract_type on contract_type.id = rule.contract_type_id
join public.cost_concepts concept on concept.id = rule.cost_concept_id
join desired_contract_cost_rules desired
  on desired.contract_type_name = upper(contract_type.name)
 and desired.concept_code = concept.code
where rule.status = 'ACTIVO'
  and rule.valid_from = date '2026-11-01'
  and rule.valid_to is null;

-- Recalculate already-materialized shift costs for the affected concepts.
update public.shift_costs cost
set contract_type_cost_rule_id = new_rule.id,
    calculation_type = 'FIXED_AMOUNT',
    rule_value = new_rule.value,
    total_cost = round(new_rule.value * cost.worked_quantity, 2),
    notes = 'Recalculado automáticamente con tarifas vigentes desde 2026-11-01',
    updated_at = public.colombia_now()
from new_contract_cost_rules new_rule,
     public.operation operation
where operation.id = cost.operation_id
  and operation.status = 'CERRADO'
  and operation.operation_date >= date '2026-11-01'
  and new_rule.contract_type_id = cost.contract_type_id
  and new_rule.cost_concept_id = cost.cost_concept_id;

-- Insert any missing affected concept (notably CCF for DIRECTO). This also
-- repairs an incomplete materialization without duplicating existing rows.
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
  sale.id,
  sale.operation_id,
  sale.operation_assignment_id,
  sale.contractor_id,
  current_contract.contract_type,
  new_rule.cost_concept_id,
  new_rule.id,
  'FIXED_AMOUNT',
  new_rule.value,
  sale.worked_quantity,
  sale.extra_hours,
  sale.total_sale,
  coalesce(assignment.total_cost, 0),
  round(new_rule.value * sale.worked_quantity, 2),
  'Recalculado automáticamente con tarifas vigentes desde 2026-11-01',
  sale.created_by,
  sale.created_by
from public.shift_sales sale
join public.operation operation on operation.id = sale.operation_id
join public.operation_assignment assignment on assignment.id = sale.operation_assignment_id
join lateral (
  select contract.contract_type
  from public.contractor_contract contract
  where contract.contractor_id = sale.contractor_id
    and contract.start_date <= operation.operation_date
    and (contract.end_date is null or contract.end_date >= operation.operation_date)
  order by contract.start_date desc nulls last, contract.id desc
  limit 1
) current_contract on true
join new_contract_cost_rules new_rule
  on new_rule.contract_type_id = current_contract.contract_type
where operation.status = 'CERRADO'
  and operation.operation_date >= date '2026-11-01'
on conflict (shift_sale_id, cost_concept_id) do update set
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

-- Apply the same rule to discharge operations. FIXED_AMOUNT uses worked
-- quantity, not discharged units, matching the current approval function.
update public.discharge_costs cost
set contract_type_cost_rule_id = new_rule.id,
    calculation_type = 'FIXED_AMOUNT',
    rule_value = new_rule.value,
    total_cost = case
      when operation.actual_units = 0 then 0
      else round(new_rule.value * assignment.worked_quantity, 2)
    end,
    notes = 'Recalculado automáticamente con tarifas vigentes desde 2026-11-01',
    updated_at = public.colombia_now()
from new_contract_cost_rules new_rule,
     public.operation operation,
     public.operation_assignment assignment
where operation.id = cost.operation_id
  and assignment.id = cost.operation_assignment_id
  and operation.status = 'CERRADO'
  and operation.operation_date >= date '2026-11-01'
  and new_rule.contract_type_id = cost.contract_type_id
  and new_rule.cost_concept_id = cost.cost_concept_id;

insert into public.discharge_costs(
  cost_at,
  discharge_sale_id,
  operation_id,
  operation_assignment_id,
  contractor_id,
  contract_type_id,
  cost_concept_id,
  contract_type_cost_rule_id,
  calculation_type,
  rule_value,
  discharged_units,
  base_sale_amount,
  base_cost_amount,
  total_cost,
  notes,
  created_by,
  updated_by
)
select
  public.colombia_now(),
  sale.id,
  sale.operation_id,
  sale.operation_assignment_id,
  sale.contractor_id,
  current_contract.contract_type,
  new_rule.cost_concept_id,
  new_rule.id,
  'FIXED_AMOUNT',
  new_rule.value,
  sale.discharged_units,
  sale.total_sale,
  sale.base_cost_amount,
  case
    when operation.actual_units = 0 then 0
    else round(new_rule.value * assignment.worked_quantity, 2)
  end,
  'Recalculado automáticamente con tarifas vigentes desde 2026-11-01',
  sale.created_by,
  sale.created_by
from public.discharge_sales sale
join public.operation operation on operation.id = sale.operation_id
join public.operation_assignment assignment on assignment.id = sale.operation_assignment_id
join lateral (
  select contract.contract_type
  from public.contractor_contract contract
  where contract.contractor_id = sale.contractor_id
    and contract.start_date <= operation.operation_date
    and (contract.end_date is null or contract.end_date >= operation.operation_date)
  order by contract.start_date desc nulls last, contract.id desc
  limit 1
) current_contract on true
join new_contract_cost_rules new_rule
  on new_rule.contract_type_id = current_contract.contract_type
where operation.status = 'CERRADO'
  and operation.operation_date >= date '2026-11-01'
on conflict (discharge_sale_id, cost_concept_id) do update set
  contract_type_id = excluded.contract_type_id,
  contract_type_cost_rule_id = excluded.contract_type_cost_rule_id,
  calculation_type = excluded.calculation_type,
  rule_value = excluded.rule_value,
  discharged_units = excluded.discharged_units,
  base_sale_amount = excluded.base_sale_amount,
  base_cost_amount = excluded.base_cost_amount,
  total_cost = excluded.total_cost,
  notes = excluded.notes,
  updated_by = excluded.updated_by,
  updated_at = public.colombia_now();

do $verification$
declare
  new_rule_count integer;
begin
  select count(*) into new_rule_count from new_contract_cost_rules;
  if new_rule_count <> 12 then
    raise exception 'Expected 12 new cost rules, found %', new_rule_count;
  end if;

  if exists (
    select 1
    from public.contract_type_cost_rules old_rule
    join new_contract_cost_rules new_rule
      on new_rule.contract_type_id = old_rule.contract_type_id
     and new_rule.cost_concept_id = old_rule.cost_concept_id
    where old_rule.id <> new_rule.id
      and old_rule.status = 'ACTIVO'
      and old_rule.valid_from < date '2026-11-01'
      and old_rule.valid_to is distinct from date '2026-10-31'
  ) then
    raise exception 'A previous affected rule was not closed on 2026-10-31';
  end if;

  if exists (
    select 1
    from public.shift_sales sale
    join public.operation operation on operation.id = sale.operation_id
    join lateral (
      select contract.contract_type
      from public.contractor_contract contract
      where contract.contractor_id = sale.contractor_id
        and contract.start_date <= operation.operation_date
        and (contract.end_date is null or contract.end_date >= operation.operation_date)
      order by contract.start_date desc nulls last, contract.id desc
      limit 1
    ) current_contract on true
    join new_contract_cost_rules new_rule
      on new_rule.contract_type_id = current_contract.contract_type
    left join public.shift_costs cost
      on cost.shift_sale_id = sale.id
     and cost.cost_concept_id = new_rule.cost_concept_id
    where operation.status = 'CERRADO'
      and operation.operation_date >= date '2026-11-01'
      and (
        cost.id is null
        or cost.contract_type_cost_rule_id <> new_rule.id
        or cost.calculation_type <> 'FIXED_AMOUNT'
        or cost.rule_value <> new_rule.value
        or cost.total_cost <> round(new_rule.value * sale.worked_quantity, 2)
      )
  ) then
    raise exception 'At least one affected shift cost was not rematerialized correctly';
  end if;

  if exists (
    select 1
    from public.discharge_sales sale
    join public.operation operation on operation.id = sale.operation_id
    join public.operation_assignment assignment on assignment.id = sale.operation_assignment_id
    join lateral (
      select contract.contract_type
      from public.contractor_contract contract
      where contract.contractor_id = sale.contractor_id
        and contract.start_date <= operation.operation_date
        and (contract.end_date is null or contract.end_date >= operation.operation_date)
      order by contract.start_date desc nulls last, contract.id desc
      limit 1
    ) current_contract on true
    join new_contract_cost_rules new_rule
      on new_rule.contract_type_id = current_contract.contract_type
    left join public.discharge_costs cost
      on cost.discharge_sale_id = sale.id
     and cost.cost_concept_id = new_rule.cost_concept_id
    where operation.status = 'CERRADO'
      and operation.operation_date >= date '2026-11-01'
      and (
        cost.id is null
        or cost.contract_type_cost_rule_id <> new_rule.id
        or cost.calculation_type <> 'FIXED_AMOUNT'
        or cost.rule_value <> new_rule.value
        or cost.total_cost <> case
          when operation.actual_units = 0 then 0
          else round(new_rule.value * assignment.worked_quantity, 2)
        end
      )
  ) then
    raise exception 'At least one affected discharge cost was not rematerialized correctly';
  end if;
end;
$verification$;
