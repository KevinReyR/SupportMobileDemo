create or replace function public.get_director_reports(
  p_month date,
  p_client_id bigint default null,
  p_contractor_id bigint default null
)
returns table (
  sale_total numeric,
  cost_total numeric,
  payroll_total numeric,
  contractors_worked bigint,
  payroll_contractors bigint,
  operations_closed bigint,
  operations_pending bigint,
  assigned_operations bigint,
  worked_shifts numeric,
  planned_shifts numeric,
  extra_hours numeric,
  absences bigint,
  clients_count bigint,
  coverage_percent numeric,
  weekly_series jsonb,
  daily_series jsonb,
  client_ranking jsonb,
  contractor_ranking jsonb,
  payroll_by_client jsonb,
  payroll_by_contractor jsonb,
  contractor_options jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  month_start date;
  month_end date;
begin
  if not public.is_active_user() then
    raise exception 'Usuario inactivo';
  end if;

  if not public.has_role('DIRECTOR') then
    raise exception 'Not authorized';
  end if;

  month_start := date_trunc('month', coalesce(p_month, public.colombia_today()))::date;
  month_end := (month_start + interval '1 month - 1 day')::date;

  return query
  with scoped_operations as (
    select
      o.id,
      o.operation_date,
      o.client_id,
      o.area_id,
      o.shift_id,
      o.status,
      c.name as client_name
    from public.operation o
    join public.clients c on c.id = o.client_id
    where o.operation_date between month_start and month_end
      and (p_client_id is null or o.client_id = p_client_id)
  ),
  scoped_assignments as (
    select
      oa.id,
      oa.operation_id,
      oa.contractor_id,
      coalesce(oa.planned_quantity, 0) as planned_quantity,
      coalesce(oa.worked_quantity, 0) as worked_quantity,
      coalesce(oa.extra_hours, 0) as extra_hours,
      ats.name as attendance_status,
      so.operation_date,
      so.client_id,
      so.client_name,
      so.status as operation_status,
      trim(coalesce(c.name, '') || ' ' || coalesce(c.last_name, '')) as contractor_name,
      c.document_number
    from public.operation_assignment oa
    join scoped_operations so on so.id = oa.operation_id
    join public.contractor c on c.id = oa.contractor_id
    left join public.attendance_status ats on ats.id = oa.attendance_status_id
    where oa.deleted_at is null
      and (p_contractor_id is null or oa.contractor_id = p_contractor_id)
  ),
  worked_assignments as (
    select *
    from scoped_assignments sa
    where sa.worked_quantity > 0
  ),
  sales_scope as (
    select ss.*
    from public.shift_sales ss
    join scoped_operations so on so.id = ss.operation_id
    where so.status = 'CERRADO'
      and (p_contractor_id is null or ss.contractor_id = p_contractor_id)
  ),
  costs_scope as (
    select
      sc.*,
      cc.category
    from public.shift_costs sc
    join scoped_operations so on so.id = sc.operation_id
    join public.cost_concepts cc on cc.id = sc.cost_concept_id
    where so.status = 'CERRADO'
      and (p_contractor_id is null or sc.contractor_id = p_contractor_id)
  ),
  payroll_scope as (
    select *
    from costs_scope cs
    where upper(cs.category) = 'NOMINA'
  ),
  weekly as (
    select
      (date_trunc('week', so.operation_date::timestamp))::date as week_start,
      'Semana ' || dense_rank() over (order by (date_trunc('week', so.operation_date::timestamp))::date) as week_label
    from scoped_operations so
    group by (date_trunc('week', so.operation_date::timestamp))::date
  ),
  weekly_payload as (
    select
      w.week_start,
      w.week_label,
      coalesce((select sum(ss.total_sale) from sales_scope ss join public.operation o on o.id = ss.operation_id where date_trunc('week', o.operation_date::timestamp)::date = w.week_start), 0) as sale_total,
      coalesce((select count(distinct wa.contractor_id) from worked_assignments wa where date_trunc('week', wa.operation_date::timestamp)::date = w.week_start), 0) as contractors,
      coalesce((select sum(wa.worked_quantity) from worked_assignments wa where date_trunc('week', wa.operation_date::timestamp)::date = w.week_start), 0) as worked_shifts,
      coalesce((select sum(sa.extra_hours) from scoped_assignments sa where date_trunc('week', sa.operation_date::timestamp)::date = w.week_start), 0) as extra_hours,
      coalesce((select count(*) from scoped_operations so where so.status = 'CERRADO' and date_trunc('week', so.operation_date::timestamp)::date = w.week_start), 0) as closed_operations
    from weekly w
  ),
  daily_payload as (
    select
      so.operation_date,
      coalesce((select sum(ss.total_sale) from sales_scope ss where ss.operation_id in (select id from scoped_operations dx where dx.operation_date = so.operation_date)), 0) as sale_total,
      coalesce((select sum(wa.worked_quantity) from worked_assignments wa where wa.operation_date = so.operation_date), 0) as worked_shifts
    from scoped_operations so
    group by so.operation_date
  ),
  client_payload as (
    select
      so.client_id,
      so.client_name,
      coalesce((select sum(ss.total_sale) from sales_scope ss join scoped_operations sx on sx.id = ss.operation_id where sx.client_id = so.client_id), 0) as sale_total,
      coalesce((select sum(cs.total_cost) from costs_scope cs join scoped_operations sx on sx.id = cs.operation_id where sx.client_id = so.client_id), 0) as cost_total,
      coalesce((select sum(ps.total_cost) from payroll_scope ps join scoped_operations sx on sx.id = ps.operation_id where sx.client_id = so.client_id), 0) as payroll_total,
      count(distinct wa.contractor_id) as contractors,
      coalesce(sum(wa.worked_quantity), 0) as worked_shifts,
      coalesce((select sum(sa.extra_hours) from scoped_assignments sa where sa.client_id = so.client_id), 0) as extra_hours
    from scoped_operations so
    left join worked_assignments wa on wa.operation_id = so.id
    group by so.client_id, so.client_name
  ),
  contractor_payload as (
    select
      wa.contractor_id,
      wa.contractor_name,
      wa.document_number,
      min(wa.client_name) as client_name,
      coalesce((select sum(ss.total_sale) from sales_scope ss where ss.contractor_id = wa.contractor_id), 0) as sale_total,
      coalesce((select sum(ps.total_cost) from payroll_scope ps where ps.contractor_id = wa.contractor_id), 0) as payroll_total,
      coalesce(sum(wa.worked_quantity), 0) as worked_shifts,
      coalesce((select sum(sa.extra_hours) from scoped_assignments sa where sa.contractor_id = wa.contractor_id), 0) as extra_hours,
      coalesce((select count(*) from scoped_assignments sa where sa.contractor_id = wa.contractor_id and upper(coalesce(sa.attendance_status, '')) = 'AUSENTE'), 0) as absences
    from worked_assignments wa
    group by wa.contractor_id, wa.contractor_name, wa.document_number
  )
  select
    coalesce((select sum(ss.total_sale) from sales_scope ss), 0) as sale_total,
    coalesce((select sum(cs.total_cost) from costs_scope cs), 0) as cost_total,
    coalesce((select sum(ps.total_cost) from payroll_scope ps), 0) as payroll_total,
    coalesce((select count(distinct wa.contractor_id) from worked_assignments wa), 0) as contractors_worked,
    coalesce((select count(distinct ps.contractor_id) from payroll_scope ps where ps.total_cost > 0), 0) as payroll_contractors,
    coalesce((select count(*) from scoped_operations so where so.status = 'CERRADO'), 0) as operations_closed,
    coalesce((select count(*) from scoped_operations so where so.status = 'PENDIENTE'), 0) as operations_pending,
    coalesce((select count(distinct sa.operation_id) from scoped_assignments sa), 0) as assigned_operations,
    coalesce((select sum(wa.worked_quantity) from worked_assignments wa), 0) as worked_shifts,
    coalesce((select sum(sa.planned_quantity) from scoped_assignments sa), 0) as planned_shifts,
    coalesce((select sum(sa.extra_hours) from scoped_assignments sa), 0) as extra_hours,
    coalesce((select count(*) from scoped_assignments sa where upper(coalesce(sa.attendance_status, '')) = 'AUSENTE'), 0) as absences,
    coalesce((select count(distinct so.client_id) from scoped_operations so), 0) as clients_count,
    case
      when coalesce((select sum(sa.planned_quantity) from scoped_assignments sa), 0) = 0 then 0
      else round((coalesce((select sum(wa.worked_quantity) from worked_assignments wa), 0) * 100.0) / nullif((select sum(sa.planned_quantity) from scoped_assignments sa), 0), 2)
    end as coverage_percent,
    coalesce((select jsonb_agg(jsonb_build_object('label', wp.week_label, 'date', wp.week_start, 'saleTotal', wp.sale_total, 'contractors', wp.contractors, 'workedShifts', wp.worked_shifts, 'extraHours', wp.extra_hours, 'closedOperations', wp.closed_operations) order by wp.week_start) from weekly_payload wp), '[]'::jsonb) as weekly_series,
    coalesce((select jsonb_agg(jsonb_build_object('label', to_char(dp.operation_date, 'DD'), 'date', dp.operation_date, 'saleTotal', dp.sale_total, 'workedShifts', dp.worked_shifts) order by dp.operation_date) from daily_payload dp), '[]'::jsonb) as daily_series,
    coalesce((select jsonb_agg(jsonb_build_object('id', cp.client_id, 'name', cp.client_name, 'saleTotal', cp.sale_total, 'costTotal', cp.cost_total, 'payrollTotal', cp.payroll_total, 'contractors', cp.contractors, 'workedShifts', cp.worked_shifts, 'extraHours', cp.extra_hours) order by cp.sale_total desc, cp.client_name) from client_payload cp), '[]'::jsonb) as client_ranking,
    coalesce((select jsonb_agg(jsonb_build_object('id', cp.contractor_id, 'name', cp.contractor_name, 'document', cp.document_number, 'clientName', cp.client_name, 'saleTotal', cp.sale_total, 'payrollTotal', cp.payroll_total, 'workedShifts', cp.worked_shifts, 'extraHours', cp.extra_hours, 'absences', cp.absences) order by cp.worked_shifts desc, cp.contractor_name) from contractor_payload cp), '[]'::jsonb) as contractor_ranking,
    coalesce((select jsonb_agg(jsonb_build_object('id', cp.client_id, 'name', cp.client_name, 'payrollTotal', cp.payroll_total, 'contractors', cp.contractors) order by cp.payroll_total desc, cp.client_name) from client_payload cp where cp.payroll_total > 0), '[]'::jsonb) as payroll_by_client,
    coalesce((select jsonb_agg(jsonb_build_object('id', cp.contractor_id, 'name', cp.contractor_name, 'document', cp.document_number, 'clientName', cp.client_name, 'payrollTotal', cp.payroll_total, 'workedShifts', cp.worked_shifts) order by cp.payroll_total desc, cp.contractor_name) from contractor_payload cp where cp.payroll_total > 0), '[]'::jsonb) as payroll_by_contractor,
    coalesce((select jsonb_agg(jsonb_build_object('id', cp.contractor_id, 'name', cp.contractor_name, 'document', cp.document_number) order by cp.contractor_name) from contractor_payload cp), '[]'::jsonb) as contractor_options;
end;
$$;

revoke execute on function public.get_director_reports(date,bigint,bigint)
  from public, anon;
grant execute on function public.get_director_reports(date,bigint,bigint)
  to authenticated;

notify pgrst, 'reload schema';
