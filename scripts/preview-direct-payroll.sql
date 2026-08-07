-- Read-only historical preview. Run only after the payroll migration exists in
-- the target database. This query does not create or update payroll periods.
begin transaction read only;

select *
from public.preview_direct_payroll_history('2026-01-01')
order by period_start, contractor_name;

select
  period_start,
  count(*) as contractors,
  sum(projected_salary) as projected_salary,
  sum(current_shift_cost) as current_shift_cost,
  sum(preserved_extra_hour_cost) as preserved_extra_hour_cost,
  sum(projected_difference) as projected_difference
from public.preview_direct_payroll_history('2026-01-01')
group by period_start
order by period_start;

rollback;
