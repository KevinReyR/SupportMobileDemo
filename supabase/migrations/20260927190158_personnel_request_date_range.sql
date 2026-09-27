alter table public.personnel_request
  add column if not exists required_end_date date;

update public.personnel_request
set required_end_date = required_date
where required_end_date is null;

alter table public.personnel_request
  alter column required_end_date set not null;

alter table public.personnel_request
  drop constraint if exists personnel_request_required_date_range_check;

alter table public.personnel_request
  add constraint personnel_request_required_date_range_check
  check (required_end_date >= required_date);
