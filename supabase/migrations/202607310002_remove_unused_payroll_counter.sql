-- Keep close_direct_payroll free of unused state after the allocation fix.
create or replace function public.close_direct_payroll(p_period_start date)
returns table (
  closed_periods bigint,
  allocated_amount numeric,
  replaced_shift_costs bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_start date := date_trunc('month', p_period_start::timestamp)::date;
  normalized_end date := (date_trunc('month', p_period_start::timestamp) + interval '1 month - 1 day')::date;
  actor uuid := auth.uid();
  target record;
  client_row record;
  weighted_total numeric;
  allocated_running numeric;
  last_allocation_id bigint;
  closed_count bigint := 0;
  allocated_total numeric := 0;
begin
  if actor is null or not public.is_active_user() or not public.has_role('ADMIN') then
    raise exception 'No autorizado';
  end if;
  if p_period_start <> normalized_start then
    raise exception 'El periodo debe iniciar el primer dia del mes';
  end if;
  if normalized_end > public.colombia_today() then
    raise exception 'El periodo actual solo puede cerrarse cuando finalice el mes';
  end if;
  if exists (
    select 1 from public.contractor_payroll_periods
    where period_start = normalized_start and status = 'CLOSED'
  ) then
    raise exception 'El periodo ya contiene nominas cerradas';
  end if;
  if not exists (
    select 1 from public.contractor_payroll_periods
    where period_start = normalized_start and status = 'DRAFT'
  ) then
    raise exception 'No existen borradores para cerrar';
  end if;

  for target in
    select pp.*
    from public.contractor_payroll_periods pp
    where pp.period_start = normalized_start and pp.status = 'DRAFT'
    order by pp.id
    for update
  loop
    delete from public.contractor_payroll_allocations
    where payroll_period_id = target.id;

    select coalesce(sum(weighted_day), 0)
    into weighted_total
    from (
      select client_id, sum(1.0 / client_count) as weighted_day
      from (
        select work_day, client_id, count(*) over (partition by work_day) as client_count
        from (
          select distinct o.operation_date as work_day, o.client_id
          from public.operation_assignment oa
          join public.operation o on o.id = oa.operation_id
          where oa.contractor_id = target.contractor_id
            and oa.deleted_at is null
            and oa.worked_quantity > 0
            and o.status = 'CERRADO'
            and o.operation_date between target.period_start and target.period_end
            and o.operation_date >= (
              select cc.start_date from public.contractor_contract cc
              where cc.id = target.contractor_contract_id
            )
            and (
              (select cc.end_date from public.contractor_contract cc where cc.id = target.contractor_contract_id) is null
              or o.operation_date <= (select cc.end_date from public.contractor_contract cc where cc.id = target.contractor_contract_id)
            )
        ) unique_client_days
      ) split_days
      group by client_id
    ) client_weights;

    allocated_running := 0;
    last_allocation_id := null;

    if weighted_total = 0 then
      insert into public.contractor_payroll_allocations(
        payroll_period_id, client_id, worked_days, allocation_percentage,
        allocated_amount, created_by, updated_by
      ) values (
        target.id, null, 0, 100, target.base_salary_amount, actor, actor
      )
      returning id into last_allocation_id;
    else
      for client_row in
        select client_id, sum(1.0 / client_count) as weighted_days
        from (
          select work_day, client_id, count(*) over (partition by work_day) as client_count
          from (
            select distinct o.operation_date as work_day, o.client_id
            from public.operation_assignment oa
            join public.operation o on o.id = oa.operation_id
            where oa.contractor_id = target.contractor_id
              and oa.deleted_at is null
              and oa.worked_quantity > 0
              and o.status = 'CERRADO'
              and o.operation_date between target.period_start and target.period_end
              and o.operation_date >= (
                select cc.start_date from public.contractor_contract cc where cc.id = target.contractor_contract_id
              )
              and (
                (select cc.end_date from public.contractor_contract cc where cc.id = target.contractor_contract_id) is null
                or o.operation_date <= (select cc.end_date from public.contractor_contract cc where cc.id = target.contractor_contract_id)
              )
          ) unique_client_days
        ) split_days
        group by client_id
        order by weighted_days desc, client_id
      loop
        insert into public.contractor_payroll_allocations(
          payroll_period_id, client_id, worked_days, allocation_percentage,
          allocated_amount, created_by, updated_by
        ) values (
          target.id,
          client_row.client_id,
          client_row.weighted_days,
          round(client_row.weighted_days * 100.0 / weighted_total, 6),
          round(target.base_salary_amount * client_row.weighted_days / weighted_total, 2),
          actor,
          actor
        )
        returning contractor_payroll_allocations.id, contractor_payroll_allocations.allocated_amount
        into last_allocation_id, allocated_running;
      end loop;

      select coalesce(sum(a.allocated_amount), 0)
      into allocated_running
      from public.contractor_payroll_allocations a
      where a.payroll_period_id = target.id;

      update public.contractor_payroll_allocations allocation
      set allocated_amount = allocation.allocated_amount + (target.base_salary_amount - allocated_running),
          updated_by = actor
      where id = last_allocation_id;
    end if;

    insert into public.payroll_replaced_shift_costs(payroll_period_id, shift_cost_id, created_by)
    select target.id, sc.id, actor
    from public.shift_costs sc
    join public.cost_concepts concept on concept.id = sc.cost_concept_id and concept.code = 'COSTO_TURNO'
    join public.operation o on o.id = sc.operation_id
    where sc.contractor_id = target.contractor_id
      and sc.contract_type_id = (
        select cc.contract_type from public.contractor_contract cc where cc.id = target.contractor_contract_id
      )
      and o.status = 'CERRADO'
      and o.operation_date between target.period_start and target.period_end
      and o.operation_date >= (
        select cc.start_date from public.contractor_contract cc where cc.id = target.contractor_contract_id
      )
      and (
        (select cc.end_date from public.contractor_contract cc where cc.id = target.contractor_contract_id) is null
        or o.operation_date <= (select cc.end_date from public.contractor_contract cc where cc.id = target.contractor_contract_id)
      )
    on conflict (shift_cost_id) do nothing;


    update public.contractor_payroll_periods
    set status = 'CLOSED',
        closed_at = public.colombia_now(),
        updated_by = actor
    where id = target.id;

    closed_count := closed_count + 1;
    allocated_total := allocated_total + target.base_salary_amount;
  end loop;

  return query select closed_count, allocated_total,
    (select count(*) from public.payroll_replaced_shift_costs prs
     join public.contractor_payroll_periods pp on pp.id = prs.payroll_period_id
     where pp.period_start = normalized_start);
end;
$$;
