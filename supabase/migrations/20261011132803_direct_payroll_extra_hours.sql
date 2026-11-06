-- Keep the extra-hour amount as a payroll snapshot. The corresponding
-- COSTO_HORA_EXTRA lines remain in shift_costs and are not allocated again.
alter table public.contractor_payroll_periods
  add column extra_hour_amount numeric(16,2) not null default 0
    check (extra_hour_amount >= 0);

create or replace function private.direct_payroll_extra_hour_amount(
  p_contract_id bigint,
  p_period_start date,
  p_period_end date
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(cost.total_cost), 0)
  from public.contractor_contract contract
  join public.contract_type contract_type
    on contract_type.id = contract.contract_type
   and upper(contract_type.name) = 'DIRECTO'
  join public.shift_costs cost
    on cost.contractor_id = contract.contractor_id
   and cost.contract_type_id = contract.contract_type
  join public.cost_concepts concept
    on concept.id = cost.cost_concept_id
   and concept.code = 'COSTO_HORA_EXTRA'
  join public.operation operation
    on operation.id = cost.operation_id
   and operation.status = 'CERRADO'
  where contract.id = p_contract_id
    and operation.operation_date between p_period_start and p_period_end
    and operation.operation_date >= contract.start_date
    and (contract.end_date is null or operation.operation_date <= contract.end_date)
    -- If contracts overlap, associate each saved cost with the same latest
    -- effective contract used when the operation was priced.
    and contract.id = (
      select effective.id
      from public.contractor_contract effective
      where effective.contractor_id = cost.contractor_id
        and effective.contract_type = cost.contract_type_id
        and effective.start_date <= operation.operation_date
        and (effective.end_date is null or effective.end_date >= operation.operation_date)
      order by effective.start_date desc, effective.id desc
      limit 1
    );
$$;

revoke all on function private.direct_payroll_extra_hour_amount(bigint,date,date)
  from public, anon, authenticated;

-- Backfill both drafts and closed periods without changing their base salary,
-- status, allocation or audit timestamps. The table lock is held until the
-- migration transaction commits, so the immutable-period trigger is restored
-- before any other transaction can write to this table.
alter table public.contractor_payroll_periods
  disable trigger contractor_payroll_periods_prevent_closed_update;
alter table public.contractor_payroll_periods
  disable trigger contractor_payroll_periods_set_updated_at;

update public.contractor_payroll_periods period
set extra_hour_amount = private.direct_payroll_extra_hour_amount(
  period.contractor_contract_id, period.period_start, period.period_end
);

alter table public.contractor_payroll_periods
  enable trigger contractor_payroll_periods_set_updated_at;
alter table public.contractor_payroll_periods
  enable trigger contractor_payroll_periods_prevent_closed_update;

-- Keep the prior RPC implementations intact; wrappers add the snapshot step
-- while preserving their public signatures for existing mobile clients.
alter function public.calculate_direct_payroll(date)
  set schema private;
alter function private.calculate_direct_payroll(date)
  rename to calculate_direct_payroll_base;
revoke all on function private.calculate_direct_payroll_base(date)
  from public, anon, authenticated;

create function public.calculate_direct_payroll(p_period_start date)
returns table (
  period_id bigint,
  contractor_id bigint,
  contractor_name text,
  eligible_days numeric,
  paid_days numeric,
  base_salary_amount numeric,
  status text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The base function validates the actor, period and salary rules.
  return query
    select * from private.calculate_direct_payroll_base(p_period_start);

  update public.contractor_payroll_periods period
  set extra_hour_amount = private.direct_payroll_extra_hour_amount(
        period.contractor_contract_id, period.period_start, period.period_end
      ),
      calculated_at = public.colombia_now(),
      updated_by = auth.uid()
  where period.period_start = p_period_start
    and period.status = 'DRAFT';
end;
$$;

revoke all on function public.calculate_direct_payroll(date) from public, anon;
grant execute on function public.calculate_direct_payroll(date) to authenticated;

alter function public.close_direct_payroll(date)
  set schema private;
alter function private.close_direct_payroll(date)
  rename to close_direct_payroll_base;
revoke all on function private.close_direct_payroll_base(date)
  from public, anon, authenticated;

create function public.close_direct_payroll(p_period_start date)
returns table (
  closed_periods bigint,
  allocated_amount numeric,
  replaced_shift_costs bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or not public.is_active_user()
    or not public.has_role('ADMIN') then
    raise exception 'No autorizado';
  end if;

  -- Refresh all draft snapshots immediately before the existing close logic.
  -- An error in the base function rolls this update back with the transaction.
  update public.contractor_payroll_periods period
  set extra_hour_amount = private.direct_payroll_extra_hour_amount(
        period.contractor_contract_id, period.period_start, period.period_end
      ),
      calculated_at = public.colombia_now(),
      updated_by = auth.uid()
  where period.period_start = p_period_start
    and period.status = 'DRAFT';

  return query
    select * from private.close_direct_payroll_base(p_period_start);
end;
$$;

revoke all on function public.close_direct_payroll(date) from public, anon;
grant execute on function public.close_direct_payroll(date) to authenticated;

-- The existing ADMIN-only RPC continues to own authorization. Enrich its
-- ordered JSON period list without changing the rule payload or other fields.
alter function public.get_admin_direct_payroll(date)
  set schema private;
alter function private.get_admin_direct_payroll(date)
  rename to get_admin_direct_payroll_base;
revoke all on function private.get_admin_direct_payroll_base(date)
  from public, anon, authenticated;

create function public.get_admin_direct_payroll(p_period_start date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  payload jsonb;
begin
  payload := private.get_admin_direct_payroll_base(p_period_start);
  return jsonb_set(
    payload,
    '{periods}',
    coalesce((
      select jsonb_agg(
        item.value || jsonb_build_object(
          'extraHourAmount', period.extra_hour_amount,
          'totalPayAmount', period.base_salary_amount + period.extra_hour_amount
        ) order by item.ordinality
      )
      from jsonb_array_elements(payload -> 'periods') with ordinality as item(value, ordinality)
      join public.contractor_payroll_periods period
        on period.id = (item.value ->> 'id')::bigint
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_admin_direct_payroll(date) from public, anon;
grant execute on function public.get_admin_direct_payroll(date) to authenticated;

notify pgrst, 'reload schema';
