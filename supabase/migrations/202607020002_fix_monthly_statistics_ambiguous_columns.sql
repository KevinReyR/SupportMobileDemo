create or replace function public.get_monthly_statistics(
  p_month date,
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
  month_start date;
  month_end date;
begin
  if not public.is_active_user() then
    raise exception 'Usuario inactivo';
  end if;

  if not (
    public.has_role('DIRECTOR')
    or public.has_role('COORDINATOR')
    or public.has_role('CLIENT')
  ) then
    raise exception 'Not authorized';
  end if;

  month_start := date_trunc('month', coalesce(p_month, public.colombia_today()))::date;
  month_end := (month_start + interval '1 month - 1 day')::date;

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
    where o.operation_date between month_start and month_end
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
    from scoped_assignments
    where coalesce(scoped_assignments.worked_quantity, 0) > 0
  ),
  active_contractors_scope as (
    select distinct c.id
    from public.contractor c
    join public.contractor_contract cc on cc.contractor_id = c.id
    join public.contract_status cs on cs.id = cc.status_id
    where upper(cs.name) = 'ACTIVO'
      and cc.start_date <= month_end
      and (cc.end_date is null or cc.end_date >= month_start)
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
    end as sale_total,
    case when public.has_role('DIRECTOR')
      then coalesce((select sum(sc.total_cost) from costs_scope sc), 0)
      else 0
    end as cost_total,
    coalesce((select count(distinct wa.contractor_id) from worked_assignments wa), 0) as contractors_worked,
    case when public.has_role('COORDINATOR')
      then coalesce((select count(*) from active_contractors_scope), 0)
      else 0
    end as active_contractors,
    coalesce((select count(distinct sa.operation_id) from scoped_assignments sa), 0) as assigned_operations,
    coalesce((select sum(wa.worked_quantity) from worked_assignments wa), 0) as worked_shifts,
    coalesce((select sum(sa.extra_hours) from scoped_assignments sa), 0) as extra_hours,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', id,
            'name', name,
            'document', document
          )
          order by name
        )
        from contractor_options_scope
      ),
      '[]'::jsonb
    ) as contractor_options;
end;
$$;

revoke execute on function public.get_monthly_statistics(date,bigint,bigint)
  from public, anon;
grant execute on function public.get_monthly_statistics(date,bigint,bigint)
  to authenticated;

notify pgrst, 'reload schema';
