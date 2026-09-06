-- Director-only payroll detail for the web management dashboard.
-- The exposed wrapper is security invoker; privileged reads stay in a private schema.

create schema if not exists private;
revoke all on schema private from public, anon;

create or replace function private.get_director_payroll_report_internal(
  p_start_date date,
  p_end_date date,
  p_client_id bigint default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  range_start date := coalesce(
    p_start_date,
    date_trunc('month', public.colombia_today()::timestamp)::date
  );
  range_end date := coalesce(p_end_date, public.colombia_today());
  result jsonb;
begin
  if auth.uid() is null
    or not public.is_active_user()
    or not public.has_role('DIRECTOR')
  then
    raise exception 'No autorizado';
  end if;

  if range_start > range_end then
    raise exception 'La fecha inicial no puede ser posterior a la fecha final';
  end if;

  with
  activity_base as (
    select
      assignment.contractor_id,
      operation.id as operation_id,
      operation.operation_date,
      operation.client_id,
      client.name as client_name,
      operation_type.code as operation_type,
      shift.name as shift_name,
      coalesce(assignment.worked_quantity, 0) as worked_quantity,
      coalesce(assignment.extra_hours, 0) as extra_hours,
      coalesce(assignment.discharged_units, 0) as discharged_units,
      effective_contract.contract_type_name
    from public.operation_assignment assignment
    join public.operation operation
      on operation.id = assignment.operation_id
      and operation.status = 'CERRADO'
    join public.clients client on client.id = operation.client_id
    join public.operation_type operation_type
      on operation_type.id = operation.operation_type_id
    left join public.shift shift on shift.id = operation.shift_id
    left join lateral (
      select contract_type.name as contract_type_name
      from public.contractor_contract contract
      join public.contract_type contract_type
        on contract_type.id = contract.contract_type
      where contract.contractor_id = assignment.contractor_id
        and contract.start_date <= operation.operation_date
        and (
          contract.end_date is null
          or contract.end_date >= operation.operation_date
        )
      order by contract.start_date desc, contract.id desc
      limit 1
    ) effective_contract on true
    where assignment.deleted_at is null
      and coalesce(assignment.worked_quantity, 0) > 0
      and operation.operation_date between range_start and range_end
      and (p_client_id is null or operation.client_id = p_client_id)
  ),
  activity as (
    select
      contractor_id,
      coalesce(sum(worked_quantity) filter (
        where operation_type = 'TURNO' and shift_name = 'Diurno'
      ), 0) as day_shifts,
      coalesce(sum(worked_quantity) filter (
        where operation_type = 'TURNO' and shift_name = 'Nocturno'
      ), 0) as night_shifts,
      coalesce(sum(worked_quantity) filter (
        where operation_type = 'TURNO'
          and shift_name in ('Medio Diurno', 'Medio Nocturno')
      ), 0) as half_shifts,
      coalesce(sum(worked_quantity) filter (
        where operation_type = 'TURNO' and shift_name = 'Festivo'
      ), 0) as holiday_shifts,
      coalesce(sum(worked_quantity) filter (
        where operation_type = 'TURNO'
          and coalesce(shift_name, '') not in (
            'Diurno', 'Nocturno', 'Medio Diurno', 'Medio Nocturno', 'Festivo'
          )
      ), 0) as other_shifts,
      coalesce(sum(worked_quantity) filter (
        where operation_type = 'TURNO'
      ), 0) as total_shifts,
      coalesce(sum(extra_hours), 0) as extra_hours,
      coalesce(sum(discharged_units) filter (
        where operation_type = 'DESCARGUE'
      ), 0) as discharged_units
    from activity_base
    group by contractor_id
  ),
  payroll_cost_lines as (
    select
      shift_cost.contractor_id,
      concept.code as concept_code,
      shift_cost.total_cost
    from public.shift_costs shift_cost
    join public.operation operation
      on operation.id = shift_cost.operation_id
      and operation.status = 'CERRADO'
    join public.cost_concepts concept
      on concept.id = shift_cost.cost_concept_id
      and upper(concept.category) = 'NOMINA'
    left join public.payroll_replaced_shift_costs replacement
      on replacement.shift_cost_id = shift_cost.id
    where replacement.shift_cost_id is null
      and operation.operation_date between range_start and range_end
      and (p_client_id is null or operation.client_id = p_client_id)

    union all

    select
      discharge_cost.contractor_id,
      concept.code as concept_code,
      discharge_cost.total_cost
    from public.discharge_costs discharge_cost
    join public.operation operation
      on operation.id = discharge_cost.operation_id
      and operation.status = 'CERRADO'
    join public.cost_concepts concept
      on concept.id = discharge_cost.cost_concept_id
      and upper(concept.category) = 'NOMINA'
    where operation.operation_date between range_start and range_end
      and (p_client_id is null or operation.client_id = p_client_id)
  ),
  operation_payroll as (
    select
      contractor_id,
      coalesce(sum(total_cost) filter (
        where concept_code = 'COSTO_TURNO'
      ), 0) as shift_pay,
      coalesce(sum(total_cost) filter (
        where concept_code = 'COSTO_HORA_EXTRA'
      ), 0) as extra_hour_pay,
      coalesce(sum(total_cost) filter (
        where concept_code not in ('COSTO_TURNO', 'COSTO_HORA_EXTRA')
      ), 0) as other_payroll_pay
    from payroll_cost_lines
    group by contractor_id
  ),
  recognized_salary_rows as (
    select
      payroll_period.id as payroll_period_id,
      payroll_period.contractor_id,
      allocation.client_id,
      coalesce(client.name, 'Sin asignar') as client_name,
      contract_type.name as contract_type_name,
      case
        when overlap_dates.overlap_start <= overlap_dates.overlap_end
          and payroll_period.eligible_days > 0
          and payroll_period.base_salary_amount > 0
        then round(
          allocation.allocated_amount
          * public.payroll_30_360_days(
              overlap_dates.overlap_start,
              overlap_dates.overlap_end
            )
          / payroll_period.eligible_days,
          2
        )
        else 0
      end as recognized_amount
    from public.contractor_payroll_periods payroll_period
    join public.contractor_contract contract
      on contract.id = payroll_period.contractor_contract_id
    join public.contract_type contract_type
      on contract_type.id = contract.contract_type
    join public.contractor_payroll_allocations allocation
      on allocation.payroll_period_id = payroll_period.id
    left join public.clients client on client.id = allocation.client_id
    cross join lateral (
      select
        greatest(range_start, payroll_period.period_start, contract.start_date)
          as overlap_start,
        least(
          range_end,
          payroll_period.period_end,
          coalesce(contract.end_date, payroll_period.period_end)
        ) as overlap_end
    ) overlap_dates
    where payroll_period.status = 'CLOSED'
      and payroll_period.period_start <= range_end
      and payroll_period.period_end >= range_start
      and (p_client_id is null or allocation.client_id = p_client_id)
  ),
  monthly_payroll as (
    select
      contractor_id,
      coalesce(sum(recognized_amount), 0) as monthly_salary_pay
    from recognized_salary_rows
    group by contractor_id
  ),
  associations as (
    select distinct
      contractor_id,
      client_id,
      client_name,
      contract_type_name
    from activity_base

    union

    select distinct
      contractor_id,
      client_id,
      client_name,
      contract_type_name
    from recognized_salary_rows
    where recognized_amount <> 0
  ),
  contractor_scope as (
    select contractor_id from activity
    union
    select contractor_id from operation_payroll
    union
    select contractor_id from monthly_payroll
  ),
  row_payload as (
    select
      contractor.id,
      document_type.name as document_type,
      contractor.document_number,
      trim(concat_ws(' ', contractor.name, contractor.last_name)) as full_name,
      coalesce((
        select jsonb_agg(client_rows.client_name order by client_rows.client_name)
        from (
          select distinct association.client_name
          from associations association
          where association.contractor_id = contractor.id
        ) client_rows
      ), '[]'::jsonb) as client_names,
      coalesce((
        select jsonb_agg(contract_rows.contract_type_name order by contract_rows.contract_type_name)
        from (
          select distinct association.contract_type_name
          from associations association
          where association.contractor_id = contractor.id
            and association.contract_type_name is not null
        ) contract_rows
      ), '[]'::jsonb) as contract_type_names,
      coalesce(activity.day_shifts, 0) as day_shifts,
      coalesce(activity.night_shifts, 0) as night_shifts,
      coalesce(activity.half_shifts, 0) as half_shifts,
      coalesce(activity.holiday_shifts, 0) as holiday_shifts,
      coalesce(activity.other_shifts, 0) as other_shifts,
      coalesce(activity.total_shifts, 0) as total_shifts,
      coalesce(activity.extra_hours, 0) as extra_hours,
      coalesce(activity.discharged_units, 0) as discharged_units,
      coalesce(operation_payroll.shift_pay, 0) as shift_pay,
      coalesce(operation_payroll.extra_hour_pay, 0) as extra_hour_pay,
      coalesce(operation_payroll.other_payroll_pay, 0) as other_payroll_pay,
      coalesce(monthly_payroll.monthly_salary_pay, 0) as monthly_salary_pay,
      coalesce(operation_payroll.shift_pay, 0)
        + coalesce(operation_payroll.extra_hour_pay, 0)
        + coalesce(operation_payroll.other_payroll_pay, 0)
        + coalesce(monthly_payroll.monthly_salary_pay, 0) as total_period
    from contractor_scope scope
    join public.contractor contractor on contractor.id = scope.contractor_id
    join public.document_type document_type
      on document_type.id = contractor.document_type_id
    left join activity on activity.contractor_id = contractor.id
    left join operation_payroll on operation_payroll.contractor_id = contractor.id
    left join monthly_payroll on monthly_payroll.contractor_id = contractor.id
  ),
  summary as (
    select
      count(*) filter (where total_period > 0) as contractors,
      coalesce(sum(total_shifts), 0) as total_shifts,
      coalesce(sum(extra_hours), 0) as extra_hours,
      coalesce(sum(discharged_units), 0) as discharged_units,
      coalesce(sum(shift_pay), 0) as shift_pay,
      coalesce(sum(extra_hour_pay), 0) as extra_hour_pay,
      coalesce(sum(other_payroll_pay), 0) as other_payroll_pay,
      coalesce(sum(monthly_salary_pay), 0) as monthly_salary_pay,
      coalesce(sum(total_period), 0) as total_payable
    from row_payload
  )
  select jsonb_build_object(
    'generatedAt', to_char(
      clock_timestamp() at time zone 'America/Bogota',
      'YYYY-MM-DD"T"HH24:MI:SS'
    ),
    'period', jsonb_build_object(
      'startDate', range_start,
      'endDate', range_end
    ),
    'summary', jsonb_build_object(
      'contractors', summary.contractors,
      'totalShifts', summary.total_shifts,
      'extraHours', summary.extra_hours,
      'dischargedUnits', summary.discharged_units,
      'shiftPay', summary.shift_pay,
      'extraHourPay', summary.extra_hour_pay,
      'otherPayrollPay', summary.other_payroll_pay,
      'monthlySalaryPay', summary.monthly_salary_pay,
      'totalPayable', summary.total_payable
    ),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', row_item.id,
        'documentType', row_item.document_type,
        'documentNumber', row_item.document_number,
        'fullName', row_item.full_name,
        'clientNames', row_item.client_names,
        'contractTypeNames', row_item.contract_type_names,
        'dayShifts', row_item.day_shifts,
        'nightShifts', row_item.night_shifts,
        'halfShifts', row_item.half_shifts,
        'holidayShifts', row_item.holiday_shifts,
        'otherShifts', row_item.other_shifts,
        'totalShifts', row_item.total_shifts,
        'extraHours', row_item.extra_hours,
        'dischargedUnits', row_item.discharged_units,
        'shiftPay', row_item.shift_pay,
        'extraHourPay', row_item.extra_hour_pay,
        'otherPayrollPay', row_item.other_payroll_pay,
        'monthlySalaryPay', row_item.monthly_salary_pay,
        'totalPeriod', row_item.total_period
      ) order by row_item.full_name, row_item.id)
      from row_payload row_item
    ), '[]'::jsonb)
  )
  into result
  from summary;

  return result;
end;
$$;

revoke execute on function private.get_director_payroll_report_internal(date,date,bigint)
  from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.get_director_payroll_report_internal(date,date,bigint)
  to authenticated;

create or replace function public.get_director_payroll_report(
  p_start_date date,
  p_end_date date,
  p_client_id bigint default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_director_payroll_report_internal(
    p_start_date,
    p_end_date,
    p_client_id
  );
$$;

revoke execute on function public.get_director_payroll_report(date,date,bigint)
  from public, anon;
grant execute on function public.get_director_payroll_report(date,date,bigint)
  to authenticated;

comment on function public.get_director_payroll_report(date,date,bigint)
  is 'Director-only approved payroll detail for the web dashboard.';

notify pgrst, 'reload schema';
