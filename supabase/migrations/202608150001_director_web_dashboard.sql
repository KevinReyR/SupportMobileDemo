-- Aggregated payload for the Director-only Opera360 web dashboard.
-- No contractor personal information is returned by this function.

create or replace function public.get_director_dashboard(
  p_start_date date,
  p_end_date date,
  p_client_id bigint default null,
  p_area_id bigint default null,
  p_operation_type text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, analytics
as $$
declare
  range_start date := coalesce(p_start_date, date_trunc('month', public.colombia_today())::date);
  range_end date := coalesce(p_end_date, public.colombia_today());
  range_days integer;
  previous_start date;
  previous_end date;
  result jsonb;
begin
  if not public.is_active_user() then
    raise exception 'Usuario inactivo';
  end if;
  if not public.has_role('DIRECTOR') then
    raise exception 'No autorizado';
  end if;
  if range_start > range_end then
    raise exception 'La fecha inicial no puede ser posterior a la fecha final';
  end if;

  range_days := range_end - range_start + 1;
  previous_end := range_start - 1;
  previous_start := previous_end - range_days + 1;

  with
  selected_finance as (
    select * from analytics.finance_daily f
    where f.report_date between previous_start and range_end
      and (p_client_id is null or f.client_id = p_client_id)
      and (p_area_id is null or f.area_id = p_area_id)
      and (p_operation_type is null or f.operation_type = p_operation_type)
  ),
  selected_operations as (
    select * from analytics.operation_daily o
    where o.report_date between previous_start and range_end
      and (p_client_id is null or o.client_id = p_client_id)
      and (p_area_id is null or o.area_id = p_area_id)
      and (p_operation_type is null or o.operation_type = p_operation_type)
  ),
  finance_periods as (
    select
      case when report_date between range_start and range_end then 'current' else 'previous' end as period,
      coalesce(sum(sale_total), 0) as sale_total,
      coalesce(sum(cost_total), 0) as cost_total,
      coalesce(sum(payroll_total), 0) as payroll_total
    from selected_finance
    group by 1
  ),
  operation_periods as (
    select
      case when report_date between range_start and range_end then 'current' else 'previous' end as period,
      coalesce(sum(closed_operations), 0) as operations_closed,
      coalesce(sum(pending_operations), 0) as operations_pending,
      coalesce(sum(planned_shifts), 0) as planned_shifts,
      coalesce(sum(worked_shifts), 0) as worked_shifts,
      coalesce(sum(extra_hours), 0) as extra_hours,
      coalesce(sum(absences), 0) as absences,
      coalesce(sum(discharge_operations), 0) as discharge_operations,
      coalesce(sum(discharged_units), 0) as discharged_units,
      coalesce(sum(assigned_contractors), 0) as assigned_contractors
    from selected_operations
    group by 1
  ),
  period_payload as (
    select p.period,
      coalesce(f.sale_total, 0) as sale_total,
      coalesce(f.cost_total, 0) as cost_total,
      coalesce(f.payroll_total, 0) as payroll_total,
      coalesce(f.sale_total, 0) - coalesce(f.cost_total, 0) as margin_total,
      case when coalesce(f.sale_total, 0) = 0 then 0
        else round((f.sale_total - f.cost_total) * 100.0 / f.sale_total, 2) end as margin_percent,
      coalesce(o.operations_closed, 0) as operations_closed,
      coalesce(o.operations_pending, 0) as operations_pending,
      coalesce(o.planned_shifts, 0) as planned_shifts,
      coalesce(o.worked_shifts, 0) as worked_shifts,
      coalesce(o.extra_hours, 0) as extra_hours,
      coalesce(o.absences, 0) as absences,
      coalesce(o.discharge_operations, 0) as discharge_operations,
      coalesce(o.discharged_units, 0) as discharged_units,
      case when coalesce(o.planned_shifts, 0) = 0 then 0
        else round(o.worked_shifts * 100.0 / o.planned_shifts, 2) end as coverage_percent
    from (values ('current'::text), ('previous'::text)) p(period)
    left join finance_periods f on f.period = p.period
    left join operation_periods o on o.period = p.period
  ),
  dates as (
    select day::date as report_date
    from generate_series(range_start::timestamp, range_end::timestamp, interval '1 day') day
  ),
  daily as (
    select d.report_date,
      coalesce((select sum(f.sale_total) from selected_finance f where f.report_date = d.report_date), 0) as sale_total,
      coalesce((select sum(f.cost_total) from selected_finance f where f.report_date = d.report_date), 0) as cost_total,
      coalesce((select sum(f.payroll_total) from selected_finance f where f.report_date = d.report_date), 0) as payroll_total,
      coalesce((select sum(o.planned_shifts) from selected_operations o where o.report_date = d.report_date), 0) as planned_shifts,
      coalesce((select sum(o.worked_shifts) from selected_operations o where o.report_date = d.report_date), 0) as worked_shifts,
      coalesce((select sum(o.extra_hours) from selected_operations o where o.report_date = d.report_date), 0) as extra_hours,
      coalesce((select sum(o.absences) from selected_operations o where o.report_date = d.report_date), 0) as absences,
      coalesce((select sum(o.closed_operations) from selected_operations o where o.report_date = d.report_date), 0) as closed_operations,
      coalesce((select sum(o.discharged_units) from selected_operations o where o.report_date = d.report_date), 0) as discharged_units
    from dates d
  ),
  current_clients as (
    select c.id, c.name,
      coalesce(sum(f.sale_total), 0) as sale_total,
      coalesce(sum(f.cost_total), 0) as cost_total,
      coalesce(sum(f.payroll_total), 0) as payroll_total
    from public.clients c
    left join selected_finance f on f.client_id = c.id and f.report_date between range_start and range_end
    where (p_client_id is null or c.id = p_client_id)
    group by c.id, c.name
  ),
  current_client_ops as (
    select client_id,
      sum(closed_operations) as operations,
      sum(planned_shifts) as planned_shifts,
      sum(worked_shifts) as worked_shifts,
      sum(extra_hours) as extra_hours,
      sum(discharge_operations) as discharge_operations,
      sum(discharged_units) as discharged_units
    from selected_operations
    where report_date between range_start and range_end
    group by client_id
  ),
  previous_clients as (
    select client_id, sum(sale_total) as sale_total, sum(cost_total) as cost_total
    from selected_finance where report_date between previous_start and previous_end group by client_id
  ),
  client_payload as (
    select c.id, c.name, c.sale_total, c.cost_total, c.payroll_total,
      c.sale_total - c.cost_total as margin_total,
      case when c.sale_total = 0 then 0 else round((c.sale_total - c.cost_total) * 100.0 / c.sale_total, 2) end as margin_percent,
      coalesce(o.operations, 0) as operations,
      coalesce(o.planned_shifts, 0) as planned_shifts,
      coalesce(o.worked_shifts, 0) as worked_shifts,
      coalesce(o.extra_hours, 0) as extra_hours,
      coalesce(o.discharge_operations, 0) as discharge_operations,
      coalesce(o.discharged_units, 0) as discharged_units,
      case when coalesce(o.planned_shifts, 0) = 0 then 0 else round(o.worked_shifts * 100.0 / o.planned_shifts, 2) end as coverage_percent,
      case when coalesce(p.sale_total, 0) = 0 then case when c.sale_total = 0 then 0 else 100 end
        else round((c.sale_total - p.sale_total) * 100.0 / abs(p.sale_total), 2) end as sale_change_percent,
      case when coalesce(p.sale_total - p.cost_total, 0) = 0 then 0
        else round(((c.sale_total - c.cost_total) - (p.sale_total - p.cost_total)) * 100.0 / abs(p.sale_total - p.cost_total), 2) end as margin_change_percent
    from current_clients c
    left join current_client_ops o on o.client_id = c.id
    left join previous_clients p on p.client_id = c.id
    where c.sale_total <> 0 or c.cost_total <> 0 or coalesce(o.operations, 0) <> 0
  ),
  shift_cost_categories as (
    select coalesce(nullif(initcap(lower(cc.category)), ''), 'Otros') as category, sum(sc.total_cost) as total
    from public.shift_costs sc
    join public.operation o on o.id = sc.operation_id and o.status = 'CERRADO'
    join public.operation_type ot on ot.id = o.operation_type_id
    join public.cost_concepts cc on cc.id = sc.cost_concept_id
    left join public.payroll_replaced_shift_costs replacement on replacement.shift_cost_id = sc.id
    where replacement.shift_cost_id is null and o.operation_date between range_start and range_end
      and (p_client_id is null or o.client_id = p_client_id)
      and (p_area_id is null or o.area_id = p_area_id)
      and (p_operation_type is null or ot.code = p_operation_type)
    group by 1
  ),
  discharge_cost_categories as (
    select coalesce(nullif(initcap(lower(cc.category)), ''), 'Otros') as category, sum(dc.total_cost) as total
    from public.discharge_costs dc
    join public.operation o on o.id = dc.operation_id and o.status = 'CERRADO'
    join public.operation_type ot on ot.id = o.operation_type_id
    join public.cost_concepts cc on cc.id = dc.cost_concept_id
    where o.operation_date between range_start and range_end
      and (p_client_id is null or o.client_id = p_client_id)
      and (p_area_id is null or o.area_id = p_area_id)
      and (p_operation_type is null or ot.code = p_operation_type)
    group by 1
  ),
  monthly_payroll_category as (
    select 'Nomina'::text as category, coalesce(sum(cost_total), 0) as total
    from selected_finance
    where report_date between range_start and range_end
      and operation_type = 'NOMINA_MENSUAL'
    having coalesce(sum(cost_total), 0) <> 0
  ),
  cost_categories as (
    select category, sum(total) as total from (
      select * from shift_cost_categories
      union all select * from discharge_cost_categories
      union all select * from monthly_payroll_category
    ) x group by category
  ),
  latest_contract as (
    select cc.*, row_number() over (partition by cc.contractor_id order by cc.start_date desc, cc.id desc) as position
    from public.contractor_contract cc
  ),
  personnel as (
    select upper(cs.name) as status, ct.name as contract_type,
      case when upper(cs.name) <> 'ACTIVO' then 'No aplica'
        when lc.start_date > public.colombia_today() - interval '3 months' then 'Hasta 3 meses'
        when lc.start_date > public.colombia_today() - interval '6 months' then '3 a 6 meses'
        when lc.start_date > public.colombia_today() - interval '12 months' then '6 a 12 meses'
        else 'Más de 12 meses' end as tenure,
      count(*) as contractors
    from latest_contract lc
    join public.contract_status cs on cs.id = lc.status_id
    join public.contract_type ct on ct.id = lc.contract_type
    where lc.position = 1
    group by 1, 2, 3
  ),
  operation_types as (
    select operation_type, operation_type_name, sum(closed_operations) as operations,
      sum(worked_shifts) as worked_shifts, sum(discharged_units) as discharged_units
    from selected_operations where report_date between range_start and range_end
    group by operation_type, operation_type_name
  ),
  filter_clients as (
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]'::jsonb) value
    from public.clients where is_active
  ),
  filter_areas as (
    select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'clientId', a.client_id) order by a.name), '[]'::jsonb) value
    from public.area a where a.is_active and (p_client_id is null or a.client_id = p_client_id)
  ),
  filter_types as (
    select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name) order by id), '[]'::jsonb) value
    from public.operation_type where is_active
  )
  select jsonb_build_object(
    'generatedAt', to_char(clock_timestamp() at time zone 'America/Bogota', 'YYYY-MM-DD"T"HH24:MI:SS'),
    'period', jsonb_build_object('startDate', range_start, 'endDate', range_end, 'previousStartDate', previous_start, 'previousEndDate', previous_end),
    'current', (select to_jsonb(p) - 'period' from period_payload p where period = 'current'),
    'previous', (select to_jsonb(p) - 'period' from period_payload p where period = 'previous'),
    'dailySeries', coalesce((select jsonb_agg(jsonb_build_object(
      'date', report_date, 'saleTotal', sale_total, 'costTotal', cost_total, 'payrollTotal', payroll_total,
      'marginTotal', sale_total - cost_total, 'plannedShifts', planned_shifts, 'workedShifts', worked_shifts,
      'extraHours', extra_hours, 'absences', absences, 'closedOperations', closed_operations, 'dischargedUnits', discharged_units
    ) order by report_date) from daily), '[]'::jsonb),
    'clients', coalesce((select jsonb_agg(to_jsonb(c) order by sale_total desc, name) from client_payload c), '[]'::jsonb),
    'costComposition', coalesce((select jsonb_agg(jsonb_build_object('name', category, 'value', total) order by total desc) from cost_categories), '[]'::jsonb),
    'contractStatus', coalesce((select jsonb_agg(jsonb_build_object('name', status, 'value', total) order by status) from (select status, sum(contractors) total from personnel group by status) s), '[]'::jsonb),
    'contractTypes', coalesce((select jsonb_agg(jsonb_build_object('name', contract_type, 'value', total) order by total desc) from (select contract_type, sum(contractors) total from personnel group by contract_type) s), '[]'::jsonb),
    'tenure', coalesce((select jsonb_agg(jsonb_build_object('name', tenure, 'value', total) order by case tenure when 'Hasta 3 meses' then 1 when '3 a 6 meses' then 2 when '6 a 12 meses' then 3 when 'Más de 12 meses' then 4 else 5 end) from (select tenure, sum(contractors) total from personnel where tenure <> 'No aplica' group by tenure) s), '[]'::jsonb),
    'operationTypes', coalesce((select jsonb_agg(to_jsonb(o) order by operation_type) from operation_types o), '[]'::jsonb),
    'filters', jsonb_build_object('clients', (select value from filter_clients), 'areas', (select value from filter_areas), 'operationTypes', (select value from filter_types))
  ) into result;

  return result;
end;
$$;

revoke execute on function public.get_director_dashboard(date,date,bigint,bigint,text) from public, anon;
grant execute on function public.get_director_dashboard(date,date,bigint,bigint,text) to authenticated;

comment on function public.get_director_dashboard(date,date,bigint,bigint,text)
  is 'Director-only aggregated web dashboard. Contains no contractor personal information.';

notify pgrst, 'reload schema';
