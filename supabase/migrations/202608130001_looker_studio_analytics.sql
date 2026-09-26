-- Aggregated, read-only reporting layer for the management dashboard.
-- The LOGIN role and its password are intentionally created outside migrations.

create schema if not exists analytics;
revoke all on schema analytics from public;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'looker_studio_reader') then
    create role looker_studio_reader nologin noinherit;
  end if;
end;
$$;

create or replace view analytics.operation_daily
with (security_barrier = true)
as
with assignment_totals as (
  select
    oa.operation_id,
    count(*) as assigned_contractors,
    coalesce(sum(oa.planned_quantity), 0) as planned_shifts,
    coalesce(sum(oa.worked_quantity), 0) as worked_shifts,
    coalesce(sum(oa.extra_hours), 0) as extra_hours,
    count(*) filter (where upper(coalesce(attendance.name, '')) = 'AUSENTE') as absences
  from public.operation_assignment oa
  left join public.attendance_status attendance on attendance.id = oa.attendance_status_id
  where oa.deleted_at is null
  group by oa.operation_id
)
select
  o.id as operation_id,
  o.operation_date as report_date,
  o.client_id,
  client.name as client_name,
  o.area_id,
  area.name as area_name,
  operation_type.code as operation_type,
  operation_type.name as operation_type_name,
  o.status as operation_status,
  case when operation_type.code = 'TURNO' then shift.name else unit_type.name end as service_name,
  1::bigint as operations,
  case when o.status = 'CERRADO' then 1 else 0 end::bigint as closed_operations,
  case when o.status = 'PENDIENTE' then 1 else 0 end::bigint as pending_operations,
  coalesce(assignments.assigned_contractors, 0)::bigint as assigned_contractors,
  case when operation_type.code = 'TURNO' then coalesce(assignments.planned_shifts, 0) else 0 end::numeric as planned_shifts,
  case when operation_type.code = 'TURNO' then coalesce(assignments.worked_shifts, 0) else 0 end::numeric as worked_shifts,
  coalesce(assignments.extra_hours, 0)::numeric as extra_hours,
  coalesce(assignments.absences, 0)::bigint as absences,
  case when operation_type.code = 'DESCARGUE' and o.status = 'CERRADO' then 1 else 0 end::bigint as discharge_operations,
  case when operation_type.code = 'DESCARGUE' and o.status = 'CERRADO' then coalesce(o.actual_units, 0) else 0 end::numeric as discharged_units
from public.operation o
join public.clients client on client.id = o.client_id
join public.area area on area.id = o.area_id
join public.operation_type operation_type on operation_type.id = o.operation_type_id
left join public.shift shift on shift.id = o.shift_id
left join public.service_unit_type unit_type on unit_type.id = o.service_unit_type_id
left join assignment_totals assignments on assignments.operation_id = o.id;

create or replace view analytics.finance_daily
with (security_barrier = true)
as
with shift_sale_totals as (
  select operation_id, sum(total_sale) as sale_total
  from public.shift_sales
  group by operation_id
),
shift_cost_totals as (
  select
    cost.operation_id,
    sum(cost.total_cost) filter (where replacement.shift_cost_id is null) as cost_total,
    sum(cost.total_cost) filter (
      where replacement.shift_cost_id is null and upper(concept.category) = 'NOMINA'
    ) as payroll_total
  from public.shift_costs cost
  join public.cost_concepts concept on concept.id = cost.cost_concept_id
  left join public.payroll_replaced_shift_costs replacement on replacement.shift_cost_id = cost.id
  group by cost.operation_id
),
discharge_sale_totals as (
  select operation_id, sum(total_sale) as sale_total
  from public.discharge_sales
  group by operation_id
),
discharge_cost_totals as (
  select
    cost.operation_id,
    sum(cost.total_cost) as cost_total,
    sum(cost.total_cost) filter (where upper(concept.category) = 'NOMINA') as payroll_total
  from public.discharge_costs cost
  join public.cost_concepts concept on concept.id = cost.cost_concept_id
  group by cost.operation_id
),
operation_finance as (
  select
    o.operation_date as report_date,
    o.client_id,
    client.name as client_name,
    o.area_id,
    area.name as area_name,
    operation_type.code as operation_type,
    coalesce(shift_sales.sale_total, 0) + coalesce(discharge_sales.sale_total, 0) as sale_total,
    coalesce(shift_costs.cost_total, 0) + coalesce(discharge_costs.cost_total, 0) as cost_total,
    coalesce(shift_costs.payroll_total, 0) + coalesce(discharge_costs.payroll_total, 0) as payroll_total
  from public.operation o
  join public.clients client on client.id = o.client_id
  join public.area area on area.id = o.area_id
  join public.operation_type operation_type on operation_type.id = o.operation_type_id
  left join shift_sale_totals shift_sales on shift_sales.operation_id = o.id
  left join shift_cost_totals shift_costs on shift_costs.operation_id = o.id
  left join discharge_sale_totals discharge_sales on discharge_sales.operation_id = o.id
  left join discharge_cost_totals discharge_costs on discharge_costs.operation_id = o.id
  where o.status = 'CERRADO'
),
payroll_days as (
  select
    period.id as payroll_period_id,
    allocation.client_id,
    day_value::date as report_date,
    allocation.allocated_amount,
    period.eligible_days,
    public.payroll_30_360_days(
      greatest(period.period_start, contract.start_date),
      day_value::date
    ) as cumulative_days
  from public.contractor_payroll_periods period
  join public.contractor_contract contract on contract.id = period.contractor_contract_id
  join public.contractor_payroll_allocations allocation on allocation.payroll_period_id = period.id
  cross join lateral generate_series(
    greatest(period.period_start, contract.start_date)::timestamp,
    least(period.period_end, coalesce(contract.end_date, period.period_end))::timestamp,
    interval '1 day'
  ) day_value
  where period.status = 'CLOSED'
    and allocation.client_id is not null
),
payroll_weighted as (
  select
    payroll_period_id,
    client_id,
    report_date,
    allocated_amount,
    eligible_days,
    cumulative_days - coalesce(
      lag(cumulative_days) over (partition by payroll_period_id, client_id order by report_date),
      0
    ) as day_weight
  from payroll_days
),
monthly_payroll as (
  select
    weighted.report_date,
    weighted.client_id,
    client.name as client_name,
    null::bigint as area_id,
    'Todas las areas'::text as area_name,
    'NOMINA_MENSUAL'::text as operation_type,
    0::numeric as sale_total,
    round(sum(weighted.allocated_amount * weighted.day_weight / nullif(weighted.eligible_days, 0)), 2) as cost_total,
    round(sum(weighted.allocated_amount * weighted.day_weight / nullif(weighted.eligible_days, 0)), 2) as payroll_total
  from payroll_weighted weighted
  join public.clients client on client.id = weighted.client_id
  where weighted.day_weight > 0
  group by weighted.report_date, weighted.client_id, client.name
)
select
  report_date,
  client_id,
  client_name,
  area_id,
  area_name,
  operation_type,
  round(sum(sale_total), 2) as sale_total,
  round(sum(cost_total), 2) as cost_total,
  round(sum(payroll_total), 2) as payroll_total,
  round(sum(sale_total) - sum(cost_total), 2) as gross_margin
from (
  select * from operation_finance
  union all
  select * from monthly_payroll
) finance
group by report_date, client_id, client_name, area_id, area_name, operation_type;

create or replace view analytics.contractor_snapshot
with (security_barrier = true)
as
with latest_contract as (
  select
    contract.*,
    row_number() over (
      partition by contract.contractor_id
      order by contract.start_date desc, contract.id desc
    ) as position
  from public.contractor_contract contract
),
classified as (
  select
    status.name as contract_status,
    contract_type.name as contract_type,
    case
      when upper(status.name) <> 'ACTIVO' then 'No aplica'
      when contract.start_date > public.colombia_today() - interval '3 months' then 'Hasta 3 meses'
      when contract.start_date > public.colombia_today() - interval '6 months' then '3 a 6 meses'
      when contract.start_date > public.colombia_today() - interval '12 months' then '6 a 12 meses'
      else 'Mas de 12 meses'
    end as tenure_bucket
  from latest_contract contract
  join public.contract_status status on status.id = contract.status_id
  join public.contract_type contract_type on contract_type.id = contract.contract_type
  where contract.position = 1
)
select
  public.colombia_today() as snapshot_date,
  contract_status,
  contract_type,
  tenure_bucket,
  count(*)::bigint as contractors
from classified
group by contract_status, contract_type, tenure_bucket;

comment on view analytics.operation_daily is 'Aggregated operational metrics without contractor personal data.';
comment on view analytics.finance_daily is 'Daily financial metrics, including closed monthly payroll distributed with the 30/360 convention.';
comment on view analytics.contractor_snapshot is 'Current aggregated contract status, type and tenure distribution.';

grant usage on schema analytics to looker_studio_reader;
grant select on analytics.operation_daily, analytics.finance_daily, analytics.contractor_snapshot
  to looker_studio_reader;

revoke all on all tables in schema analytics from public, anon, authenticated;

