create or replace function public.get_discharge_report_metrics(
  p_start_date date,
  p_end_date date,
  p_client_id bigint default null,
  p_contractor_id bigint default null
)
returns jsonb
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
  if not public.is_active_user() then raise exception 'Usuario inactivo'; end if;
  if not (public.has_role('DIRECTOR') or public.has_role('COORDINATOR') or public.has_role('CLIENT')) then
    raise exception 'No autorizado';
  end if;
  if range_start > range_end then raise exception 'La fecha inicial no puede ser posterior a la fecha final'; end if;

  granularity := case when range_end - range_start + 1 <= 31 then 'DAY'
    when range_end - range_start + 1 <= 366 then 'WEEK' else 'MONTH' end;

  return (
    with scoped_operations as (
      select o.*, c.name as client_name,
        case granularity when 'DAY' then o.operation_date
          when 'WEEK' then date_trunc('week', o.operation_date::timestamp)::date
          else date_trunc('month', o.operation_date::timestamp)::date end as bucket_start
      from public.operation o
      join public.clients c on c.id = o.client_id
      where o.operation_type_id = 2
        and o.operation_date between range_start and range_end
        and (p_client_id is null or o.client_id = p_client_id)
        and (public.has_role('DIRECTOR') or public.has_client_access(o.client_id))
    ),
    assignments as (
      select oa.*, so.operation_date, so.client_id, so.client_name, so.bucket_start, so.status,
        trim(coalesce(c.name, '') || ' ' || coalesce(c.last_name, '')) as contractor_name,
        c.document_number
      from public.operation_assignment oa
      join scoped_operations so on so.id = oa.operation_id
      join public.contractor c on c.id = oa.contractor_id
      where oa.deleted_at is null
        and (p_contractor_id is null or oa.contractor_id = p_contractor_id)
    ),
    sales as (
      select ds.*, so.client_id, so.client_name, so.bucket_start
      from public.discharge_sales ds join scoped_operations so on so.id = ds.operation_id
      where so.status = 'CERRADO' and (p_contractor_id is null or ds.contractor_id = p_contractor_id)
    ),
    costs as (
      select dc.*, cc.category, so.client_id, so.client_name
      from public.discharge_costs dc
      join scoped_operations so on so.id = dc.operation_id
      join public.cost_concepts cc on cc.id = dc.cost_concept_id
      where so.status = 'CERRADO' and (p_contractor_id is null or dc.contractor_id = p_contractor_id)
    ),
    trend as (
      select so.bucket_start,
        case granularity when 'DAY' then to_char(so.bucket_start, 'DD/MM')
          when 'WEEK' then 'Sem ' || to_char(so.bucket_start, 'DD/MM')
          else to_char(so.bucket_start, 'MM/YYYY') end as label,
        coalesce((select sum(s.total_sale) from sales s where s.bucket_start = so.bucket_start), 0) sale_total,
        count(*) filter (where so.status = 'CERRADO') discharge_operations,
        coalesce(sum(so.actual_units) filter (where so.status = 'CERRADO'), 0) discharged_units
      from scoped_operations so group by so.bucket_start
    ),
    client_rows as (
      select so.client_id id, so.client_name name,
        coalesce((select sum(s.total_sale) from sales s where s.client_id = so.client_id), 0) sale_total,
        coalesce((select sum(c.total_cost) from costs c where c.client_id = so.client_id), 0) cost_total,
        coalesce((select sum(c.total_cost) from costs c where c.client_id = so.client_id and upper(c.category) = 'NOMINA'), 0) payroll_total,
        count(*) filter (where so.status = 'CERRADO') discharge_operations,
        coalesce(sum(so.actual_units) filter (where so.status = 'CERRADO'), 0) discharged_units
      from scoped_operations so group by so.client_id, so.client_name
    ),
    contractor_rows as (
      select a.contractor_id id, min(a.contractor_name) name, min(a.document_number) document,
        min(a.client_name) client_name,
        coalesce((select sum(s.total_sale) from sales s where s.contractor_id = a.contractor_id), 0) sale_total,
        coalesce((select sum(c.total_cost) from costs c where c.contractor_id = a.contractor_id), 0) cost_total,
        coalesce((select sum(c.total_cost) from costs c where c.contractor_id = a.contractor_id and upper(c.category) = 'NOMINA'), 0) payroll_total,
        count(distinct a.operation_id) filter (where a.status = 'CERRADO' and a.worked_quantity > 0) discharge_operations,
        coalesce(sum(a.discharged_units) filter (where a.status = 'CERRADO'), 0) discharged_units
      from assignments a group by a.contractor_id
    )
    select jsonb_build_object(
      'sale_total', case when public.has_role('DIRECTOR') then coalesce((select sum(total_sale) from sales), 0) else 0 end,
      'cost_total', case when public.has_role('DIRECTOR') then coalesce((select sum(total_cost) from costs), 0) else 0 end,
      'payroll_total', case when public.has_role('DIRECTOR') then coalesce((select sum(total_cost) from costs where upper(category) = 'NOMINA'), 0) else 0 end,
      'discharge_operations', coalesce((select count(*) from scoped_operations where status = 'CERRADO'), 0),
      'discharged_units', coalesce((select sum(actual_units) from scoped_operations where status = 'CERRADO'), 0),
      'assignment_count', coalesce((select count(*) from assignments), 0),
      'attendee_count', coalesce((select count(*) from assignments where worked_quantity > 0), 0),
      'contractor_options', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'document', document) order by name) from contractor_rows), '[]'::jsonb),
      'trend_series', coalesce((select jsonb_agg(jsonb_build_object('date', bucket_start, 'label', label, 'saleTotal', sale_total, 'dischargeOperations', discharge_operations, 'dischargedUnits', discharged_units) order by bucket_start) from trend), '[]'::jsonb),
      'client_ranking', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'saleTotal', sale_total, 'costTotal', cost_total, 'payrollTotal', payroll_total, 'dischargeOperations', discharge_operations, 'dischargedUnits', discharged_units) order by sale_total desc, name) from client_rows), '[]'::jsonb),
      'contractor_ranking', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'document', document, 'clientName', client_name, 'saleTotal', sale_total, 'costTotal', cost_total, 'payrollTotal', payroll_total, 'dischargeOperations', discharge_operations, 'dischargedUnits', discharged_units) order by discharged_units desc, name) from contractor_rows), '[]'::jsonb)
    )
  );
end;
$$;

revoke execute on function public.get_discharge_report_metrics(date,date,bigint,bigint) from public, anon;
grant execute on function public.get_discharge_report_metrics(date,date,bigint,bigint) to authenticated;

notify pgrst, 'reload schema';
