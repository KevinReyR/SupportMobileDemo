-- Keep the stored ENVIADA status for installed clients; expose mora in versioned read RPCs.
create function public.get_statement_v2(p_id bigint)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  result jsonb;
  credit integer;
  due date;
  today date := (now() at time zone 'America/Bogota')::date;
  effective_status text;
begin
  result := public.get_statement(p_id);
  select c.credit_days into credit from public.clients c where c.id=(result->>'client_id')::bigint;
  due := (result->>'sent_date')::date + credit;
  effective_status := case when result->>'status'='ENVIADA' and today>due then 'EN_MORA' else result->>'status' end;
  return result || jsonb_build_object(
    'status',effective_status,
    'credit_days',credit,
    'due_date',due,
    'days_overdue',case when effective_status='EN_MORA' then today-due else null end
  );
end $$;

create function public.list_statements_v2(
  p_client_id bigint default null,
  p_area_id bigint default null,
  p_status text default null,
  p_start_date date default null,
  p_end_date date default null,
  p_before_id bigint default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  result jsonb;
  today date := (now() at time zone 'America/Bogota')::date;
begin
  perform public.statement_require_role('DIRECTOR');
  if p_start_date>p_end_date then raise exception 'Rango no valido'; end if;

  with eligible as (
    select s.*,c.credit_days,s.sent_date+c.credit_days as due_date,
      case when s.sent_date is null then null else coalesce(s.paid_date,today)-s.sent_date end as days_since_sent,
      case when s.status='ENVIADA' and today>s.sent_date+c.credit_days
        then today-(s.sent_date+c.credit_days) else null end as days_overdue,
      case when s.status='ENVIADA' and today>s.sent_date+c.credit_days
        then 'EN_MORA' else s.status end as effective_status
    from public.service_statements s
    join public.clients c on c.id=s.client_id
    where (p_client_id is null or s.client_id=p_client_id)
      and (p_area_id is null or s.area_id=p_area_id)
      and (p_start_date is null or s.end_date>=p_start_date)
      and (p_end_date is null or s.start_date<=p_end_date)
      and (p_before_id is null or s.id<p_before_id)
  ), page as (
    select * from eligible
    where p_status is null or effective_status=p_status
    order by id desc limit 31
  )
  select coalesce(jsonb_agg(
    (to_jsonb(page)-'effective_status')||jsonb_build_object('status',page.effective_status)
    order by page.id desc
  ),'[]'::jsonb) into result from page;
  return result;
end $$;

revoke all on function public.get_statement_v2(bigint),
  public.list_statements_v2(bigint,bigint,text,date,date,bigint) from public,anon,authenticated;
grant execute on function public.get_statement_v2(bigint),
  public.list_statements_v2(bigint,bigint,text,date,date,bigint) to authenticated;
notify pgrst,'reload schema';
