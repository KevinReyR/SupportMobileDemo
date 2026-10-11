-- Run against a disposable PostgreSQL 17 database with:
-- psql -v ON_ERROR_STOP=1 -f tests/sql/direct_payroll_extra_hours_smoke.sql
begin;

create schema auth;
create schema private;
create role anon;
create role authenticated;

create function auth.uid() returns uuid language sql stable as $$
  select '00000000-0000-0000-0000-000000000001'::uuid;
$$;
create function public.is_active_user() returns boolean language sql stable as $$
  select true;
$$;
create function public.has_role(text) returns boolean language sql stable as $$
  select $1 = 'ADMIN';
$$;
create function public.colombia_now() returns timestamp language sql stable as $$
  select '2026-10-11 08:00:00'::timestamp;
$$;

create table public.contract_type (id bigint primary key, name text not null);
create table public.contractor_contract (
  id bigint primary key,
  contractor_id bigint not null,
  contract_type bigint not null,
  start_date date not null,
  end_date date
);
create table public.cost_concepts (id bigint primary key, code text not null);
create table public.operation (
  id bigint primary key,
  operation_date date not null,
  status text not null
);
create table public.shift_costs (
  id bigint primary key,
  contractor_id bigint not null,
  contract_type_id bigint not null,
  cost_concept_id bigint not null,
  operation_id bigint not null,
  total_cost numeric(16,2) not null
);
create table public.contractor_payroll_periods (
  id bigint primary key,
  contractor_id bigint not null,
  contractor_contract_id bigint not null,
  period_start date not null,
  period_end date not null,
  base_salary_amount numeric(16,2) not null,
  status text not null,
  calculated_at timestamp,
  updated_at timestamp,
  updated_by uuid
);

create function public.prevent_closed_payroll_mutation() returns trigger
language plpgsql as $$
begin
  if old.status = 'CLOSED' then
    raise exception 'Un periodo de nomina cerrado es inmutable';
  end if;
  return new;
end;
$$;
create trigger contractor_payroll_periods_prevent_closed_update
before update or delete on public.contractor_payroll_periods
for each row execute function public.prevent_closed_payroll_mutation();

create function public.set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := public.colombia_now();
  return new;
end;
$$;
create trigger contractor_payroll_periods_set_updated_at
before update on public.contractor_payroll_periods
for each row execute function public.set_updated_at();

create function public.calculate_direct_payroll(p_period_start date)
returns table (
  period_id bigint, contractor_id bigint, contractor_name text,
  eligible_days numeric, paid_days numeric, base_salary_amount numeric, status text
)
language sql security definer as $$
  select id, contractor_id, 'Directo'::text, 30::numeric, 30::numeric,
    base_salary_amount, status
  from public.contractor_payroll_periods
  where period_start = p_period_start;
$$;

create function public.close_direct_payroll(p_period_start date)
returns table (closed_periods bigint, allocated_amount numeric, replaced_shift_costs bigint)
language plpgsql security definer as $$
declare
  changed bigint;
  salary numeric;
begin
  select count(*), coalesce(sum(base_salary_amount), 0)
  into changed, salary
  from public.contractor_payroll_periods where period_start = p_period_start and status = 'DRAFT';
  update public.contractor_payroll_periods
  set status = 'CLOSED' where period_start = p_period_start and status = 'DRAFT';
  return query select changed, salary, 0::bigint;
end;
$$;

create function public.get_admin_direct_payroll(p_period_start date)
returns jsonb language sql stable security definer as $$
  select jsonb_build_object(
    'periodStart', p_period_start,
    'periods', coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'baseSalaryAmount', base_salary_amount,
      'status', status
    ) order by id), '[]'::jsonb),
    'rules', '[]'::jsonb
  )
  from public.contractor_payroll_periods
  where period_start = p_period_start;
$$;

insert into public.contract_type values (1, 'DIRECTO'), (2, 'SOLO ARL');
insert into public.contractor_contract values
  (10, 1, 1, '2026-07-01', null),
  (20, 2, 2, '2026-07-01', null);
insert into public.cost_concepts values (1, 'COSTO_HORA_EXTRA'), (2, 'COSTO_TURNO');
insert into public.operation values
  (1, '2026-07-10', 'CERRADO'),
  (2, '2026-07-20', 'CERRADO'),
  (3, '2026-07-21', 'PENDIENTE'),
  (4, '2026-08-10', 'CERRADO'),
  (5, '2026-09-10', 'CERRADO');
insert into public.shift_costs values
  (1, 1, 1, 1, 1, 100),
  (2, 1, 1, 1, 2, 50),
  (3, 1, 1, 1, 3, 999),
  (4, 1, 1, 1, 4, 25),
  (5, 2, 2, 1, 1, 800),
  (6, 1, 1, 2, 1, 500);
insert into public.contractor_payroll_periods values
  (1, 1, 10, '2026-07-01', '2026-07-31', 1000, 'DRAFT', null, '2026-07-01', null),
  (2, 1, 10, '2026-08-01', '2026-08-31', 1000, 'CLOSED', null, '2026-08-01', null),
  (3, 1, 10, '2026-09-01', '2026-09-30', 1000, 'DRAFT', null, '2026-09-01', null);

\ir ../../supabase/migrations/20261011132803_direct_payroll_extra_hours.sql

do $$
begin
  if (select extra_hour_amount from public.contractor_payroll_periods where id = 1) <> 150
    or (select extra_hour_amount from public.contractor_payroll_periods where id = 2) <> 25
    or (select extra_hour_amount from public.contractor_payroll_periods where id = 3) <> 0 then
    raise exception 'Historical backfill failed';
  end if;
  if (select updated_at from public.contractor_payroll_periods where id = 2) <> '2026-08-01'::timestamp then
    raise exception 'Closed-period audit timestamp changed';
  end if;
end;
$$;

insert into public.shift_costs values (7, 1, 1, 1, 2, 30);
select * from public.calculate_direct_payroll('2026-07-01');
do $$
begin
  if (select extra_hour_amount from public.contractor_payroll_periods where id = 1) <> 180 then
    raise exception 'Draft recalculation failed';
  end if;
end;
$$;

update public.contractor_payroll_periods set base_salary_amount = 900 where id = 1;
insert into public.shift_costs values (8, 1, 1, 1, 2, 20);
select * from public.close_direct_payroll('2026-07-01');
do $$
declare
  payload jsonb;
begin
  payload := public.get_admin_direct_payroll('2026-07-01');
  if (select extra_hour_amount from public.contractor_payroll_periods where id = 1) <> 200
    or (select status from public.contractor_payroll_periods where id = 1) <> 'CLOSED'
    or (payload #>> '{periods,0,totalPayAmount}')::numeric <> 1100 then
    raise exception 'Close snapshot or payable total failed';
  end if;
end;
$$;

insert into public.shift_costs values (9, 1, 1, 1, 2, 90);
select * from public.calculate_direct_payroll('2026-07-01');
do $$
declare
  blocked boolean := false;
begin
  if (select extra_hour_amount from public.contractor_payroll_periods where id = 1) <> 200 then
    raise exception 'Closed period changed after recalculation';
  end if;
  begin
    update public.contractor_payroll_periods set base_salary_amount = 0 where id = 1;
  exception when raise_exception then
    blocked := true;
  end;
  if not blocked then
    raise exception 'Closed period is not immutable';
  end if;
  if has_function_privilege('anon', 'public.calculate_direct_payroll(date)', 'EXECUTE') then
    raise exception 'Anonymous execution unexpectedly allowed';
  end if;
  if has_function_privilege('anon', 'public.close_direct_payroll(date)', 'EXECUTE')
    or has_function_privilege('anon', 'public.get_admin_direct_payroll(date)', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.direct_payroll_extra_hour_amount(bigint,date,date)', 'EXECUTE') then
    raise exception 'Payroll function permission unexpectedly granted';
  end if;
end;
$$;

rollback;
