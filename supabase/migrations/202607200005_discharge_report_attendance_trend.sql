create or replace function public.get_discharge_attendance_trend(
  p_start_date date,
  p_end_date date,
  p_client_id bigint default null,
  p_contractor_id bigint default null
)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  range_start date := coalesce(p_start_date, date_trunc('month', public.colombia_today())::date);
  range_end date := coalesce(p_end_date, public.colombia_today());
  granularity text;
begin
  if not public.is_active_user() or not public.has_role('DIRECTOR') then raise exception 'No autorizado'; end if;
  if range_start > range_end then raise exception 'La fecha inicial no puede ser posterior a la fecha final'; end if;
  granularity := case when range_end - range_start + 1 <= 31 then 'DAY'
    when range_end - range_start + 1 <= 366 then 'WEEK' else 'MONTH' end;
  return coalesce((
    select jsonb_agg(jsonb_build_object('date', x.bucket_start, 'attendeeCount', x.attendee_count) order by x.bucket_start)
    from (
      select case granularity when 'DAY' then o.operation_date
          when 'WEEK' then date_trunc('week', o.operation_date::timestamp)::date
          else date_trunc('month', o.operation_date::timestamp)::date end bucket_start,
        count(*) filter (where coalesce(oa.worked_quantity, 0) > 0) attendee_count
      from public.operation o
      join public.operation_assignment oa on oa.operation_id = o.id and oa.deleted_at is null
      where o.operation_type_id = 2
        and o.operation_date between range_start and range_end
        and (p_client_id is null or o.client_id = p_client_id)
        and (p_contractor_id is null or oa.contractor_id = p_contractor_id)
      group by 1
    ) x
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.get_discharge_attendance_trend(date,date,bigint,bigint) from public, anon;
grant execute on function public.get_discharge_attendance_trend(date,date,bigint,bigint) to authenticated;

notify pgrst, 'reload schema';
