create or replace function public.get_statistics_by_date_range(
  p_start_date date,
  p_end_date date,
  p_client_id bigint default null,
  p_contractor_id bigint default null
)
returns table (
  sale_total numeric,
  cost_total numeric,
  contractors_worked bigint,
  active_contractors bigint,
  assigned_operations bigint,
  worked_shifts numeric,
  extra_hours numeric,
  contractor_options jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  range_start date := coalesce(p_start_date, date_trunc('month', public.colombia_today())::date);
  range_end date := coalesce(p_end_date, public.colombia_today());
begin
  if not public.is_active_user() then
    raise exception 'Usuario inactivo';
  end if;

  if not (
    public.has_role('DIRECTOR')
    or public.has_role('COORDINATOR')
    or public.has_role('CLIENT')
  ) then
    raise exception 'No autorizado';
  end if;

  if range_start > range_end then
    raise exception 'La fecha inicial no puede ser posterior a la fecha final';
  end if;

  return query
  with authorized_clients as (
    select c.id
    from public.clients c
    where c.is_active
      and (p_client_id is null or c.id = p_client_id)
      and (
        public.has_role('DIRECTOR')
        or public.has_client_access(c.id)
      )
  ),
  scoped_operations as (
    select o.*
    from public.operation o
    join authorized_clients ac on ac.id = o.client_id
    where o.operation_date between range_start and range_end
  ),
  scoped_assignments as (
    select
      oa.*,
      so.operation_date,
      so.client_id,
      so.status as operation_status
    from public.operation_assignment oa
    join scoped_operations so on so.id = oa.operation_id
    where oa.deleted_at is null
      and (p_contractor_id is null or oa.contractor_id = p_contractor_id)
  ),
  worked_assignments as (
    select *
    from scoped_assignments sa
    where coalesce(sa.worked_quantity, 0) > 0
  ),
  active_contractors_scope as (
    select distinct c.id
    from public.contractor c
    join public.contractor_contract cc on cc.contractor_id = c.id
    join public.contract_status cs on cs.id = cc.status_id
    where upper(cs.name) = 'ACTIVO'
      and cc.start_date <= range_end
      and (cc.end_date is null or cc.end_date >= range_start)
      and (p_contractor_id is null or c.id = p_contractor_id)
      and (
        public.has_role('DIRECTOR')
        or exists (
          select 1
          from public.operation_assignment oa
          join public.operation o on o.id = oa.operation_id
          join authorized_clients ac on ac.id = o.client_id
          where oa.contractor_id = c.id
            and oa.deleted_at is null
        )
      )
  ),
  sales_scope as (
    select ss.*
    from public.shift_sales ss
    join scoped_operations so on so.id = ss.operation_id
    where so.status = 'CERRADO'
      and (p_contractor_id is null or ss.contractor_id = p_contractor_id)
  ),
  costs_scope as (
    select sc.*
    from public.shift_costs sc
    join scoped_operations so on so.id = sc.operation_id
    where so.status = 'CERRADO'
      and (p_contractor_id is null or sc.contractor_id = p_contractor_id)
  ),
  contractor_options_scope as (
    select distinct
      c.id,
      trim(coalesce(c.name, '') || ' ' || coalesce(c.last_name, '')) as name,
      c.document_number as document
    from worked_assignments wa
    join public.contractor c on c.id = wa.contractor_id
  )
  select
    case when public.has_role('DIRECTOR')
      then coalesce((select sum(ss.total_sale) from sales_scope ss), 0)
      else 0
    end,
    case when public.has_role('DIRECTOR')
      then coalesce((select sum(sc.total_cost) from costs_scope sc), 0)
      else 0
    end,
    coalesce((select count(distinct wa.contractor_id) from worked_assignments wa), 0),
    case when public.has_role('COORDINATOR')
      then coalesce((select count(*) from active_contractors_scope), 0)
      else 0
    end,
    coalesce((select count(distinct sa.operation_id) from scoped_assignments sa), 0),
    coalesce((select sum(wa.worked_quantity) from worked_assignments wa), 0),
    coalesce((select sum(sa.extra_hours) from scoped_assignments sa), 0),
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('id', cos.id, 'name', cos.name, 'document', cos.document)
          order by cos.name
        )
        from contractor_options_scope cos
      ),
      '[]'::jsonb
    );
end;
$$;

revoke execute on function public.get_statistics_by_date_range(date,date,bigint,bigint)
  from public, anon;
grant execute on function public.get_statistics_by_date_range(date,date,bigint,bigint)
  to authenticated;

create or replace function public.get_director_reports(
  p_start_date date,
  p_end_date date,
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
  trend_granularity text,
  trend_series jsonb,
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
  range_start date := coalesce(p_start_date, date_trunc('month', public.colombia_today())::date);
  range_end date := coalesce(p_end_date, public.colombia_today());
  granularity text;
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

  granularity := case
    when (range_end - range_start + 1) <= 31 then 'DAY'
    when (range_end - range_start + 1) <= 366 then 'WEEK'
    else 'MONTH'
  end;

  return query
  with scoped_operations as (
    select
      o.id,
      o.operation_date,
      o.client_id,
      o.area_id,
      o.shift_id,
      o.status,
      c.name as client_name,
      case granularity
        when 'DAY' then o.operation_date
        when 'WEEK' then date_trunc('week', o.operation_date::timestamp)::date
        else date_trunc('month', o.operation_date::timestamp)::date
      end as bucket_start
    from public.operation o
    join public.clients c on c.id = o.client_id
    where o.operation_date between range_start and range_end
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
      so.bucket_start,
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
    select * from scoped_assignments sa where sa.worked_quantity > 0
  ),
  sales_scope as (
    select ss.*, so.bucket_start
    from public.shift_sales ss
    join scoped_operations so on so.id = ss.operation_id
    where so.status = 'CERRADO'
      and (p_contractor_id is null or ss.contractor_id = p_contractor_id)
  ),
  costs_scope as (
    select sc.*, cc.category
    from public.shift_costs sc
    join scoped_operations so on so.id = sc.operation_id
    join public.cost_concepts cc on cc.id = sc.cost_concept_id
    where so.status = 'CERRADO'
      and (p_contractor_id is null or sc.contractor_id = p_contractor_id)
  ),
  payroll_scope as (
    select * from costs_scope cs where upper(cs.category) = 'NOMINA'
  ),
  trend_payload as (
    select
      so.bucket_start,
      case granularity
        when 'DAY' then to_char(so.bucket_start, 'DD/MM')
        when 'WEEK' then 'Sem ' || to_char(so.bucket_start, 'DD/MM')
        else to_char(so.bucket_start, 'MM/YYYY')
      end as bucket_label,
      coalesce((select sum(ss.total_sale) from sales_scope ss where ss.bucket_start = so.bucket_start), 0) as sale_total,
      coalesce((select count(distinct wa.contractor_id) from worked_assignments wa where wa.bucket_start = so.bucket_start), 0) as contractors,
      coalesce((select sum(wa.worked_quantity) from worked_assignments wa where wa.bucket_start = so.bucket_start), 0) as worked_shifts,
      coalesce((select sum(sa.extra_hours) from scoped_assignments sa where sa.bucket_start = so.bucket_start), 0) as extra_hours,
      coalesce((select count(*) from scoped_operations sx where sx.status = 'CERRADO' and sx.bucket_start = so.bucket_start), 0) as closed_operations
    from scoped_operations so
    group by so.bucket_start
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
    coalesce((select sum(ss.total_sale) from sales_scope ss), 0),
    coalesce((select sum(cs.total_cost) from costs_scope cs), 0),
    coalesce((select sum(ps.total_cost) from payroll_scope ps), 0),
    coalesce((select count(distinct wa.contractor_id) from worked_assignments wa), 0),
    coalesce((select count(distinct ps.contractor_id) from payroll_scope ps where ps.total_cost > 0), 0),
    coalesce((select count(*) from scoped_operations so where so.status = 'CERRADO'), 0),
    coalesce((select count(*) from scoped_operations so where so.status = 'PENDIENTE'), 0),
    coalesce((select count(distinct sa.operation_id) from scoped_assignments sa), 0),
    coalesce((select sum(wa.worked_quantity) from worked_assignments wa), 0),
    coalesce((select sum(sa.planned_quantity) from scoped_assignments sa), 0),
    coalesce((select sum(sa.extra_hours) from scoped_assignments sa), 0),
    coalesce((select count(*) from scoped_assignments sa where upper(coalesce(sa.attendance_status, '')) = 'AUSENTE'), 0),
    coalesce((select count(distinct so.client_id) from scoped_operations so), 0),
    case
      when coalesce((select sum(sa.planned_quantity) from scoped_assignments sa), 0) = 0 then 0
      else round((coalesce((select sum(wa.worked_quantity) from worked_assignments wa), 0) * 100.0) / nullif((select sum(sa.planned_quantity) from scoped_assignments sa), 0), 2)
    end,
    granularity,
    coalesce((select jsonb_agg(jsonb_build_object('label', tp.bucket_label, 'date', tp.bucket_start, 'saleTotal', tp.sale_total, 'contractors', tp.contractors, 'workedShifts', tp.worked_shifts, 'extraHours', tp.extra_hours, 'closedOperations', tp.closed_operations) order by tp.bucket_start) from trend_payload tp), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('id', cp.client_id, 'name', cp.client_name, 'saleTotal', cp.sale_total, 'costTotal', cp.cost_total, 'payrollTotal', cp.payroll_total, 'contractors', cp.contractors, 'workedShifts', cp.worked_shifts, 'extraHours', cp.extra_hours) order by cp.sale_total desc, cp.client_name) from client_payload cp), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('id', cp.contractor_id, 'name', cp.contractor_name, 'document', cp.document_number, 'clientName', cp.client_name, 'saleTotal', cp.sale_total, 'payrollTotal', cp.payroll_total, 'workedShifts', cp.worked_shifts, 'extraHours', cp.extra_hours, 'absences', cp.absences) order by cp.worked_shifts desc, cp.contractor_name) from contractor_payload cp), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('id', cp.client_id, 'name', cp.client_name, 'payrollTotal', cp.payroll_total, 'contractors', cp.contractors) order by cp.payroll_total desc, cp.client_name) from client_payload cp where cp.payroll_total > 0), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('id', cp.contractor_id, 'name', cp.contractor_name, 'document', cp.document_number, 'clientName', cp.client_name, 'payrollTotal', cp.payroll_total, 'workedShifts', cp.worked_shifts) order by cp.payroll_total desc, cp.contractor_name) from contractor_payload cp where cp.payroll_total > 0), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('id', cp.contractor_id, 'name', cp.contractor_name, 'document', cp.document_number) order by cp.contractor_name) from contractor_payload cp), '[]'::jsonb);
end;
$$;

revoke execute on function public.get_director_reports(date,date,bigint,bigint)
  from public, anon;
grant execute on function public.get_director_reports(date,date,bigint,bigint)
  to authenticated;

notify pgrst, 'reload schema';
