-- Current receivables are open, sent statements. Dates are Colombian calendar dates.
create function public.get_director_receivables_summary(p_client_id bigint default null, p_area_id bigint default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; today date := (now() at time zone 'America/Bogota')::date;
begin
  perform public.statement_require_role('DIRECTOR');
  with open_items as (
    select s.client_id, c.name as client_name, s.total,
      greatest(today-(s.sent_date+c.credit_days),0) as overdue_days
    from public.service_statements s join public.clients c on c.id=s.client_id
    where s.status='ENVIADA' and (p_client_id is null or s.client_id=p_client_id)
      and (p_area_id is null or s.area_id=p_area_id)
  ), totals as (
    select coalesce(sum(total),0) as portfolio_total,
      coalesce(sum(total) filter (where overdue_days=0),0) as due_soon,
      coalesce(sum(total) filter (where overdue_days>0),0) as overdue,
      count(*) as open_count, count(*) filter (where overdue_days>0) as overdue_count,
      coalesce(sum(total) filter (where overdue_days between 1 and 30),0) as age_1_30,
      coalesce(sum(total) filter (where overdue_days between 31 and 60),0) as age_31_60,
      coalesce(sum(total) filter (where overdue_days between 61 and 90),0) as age_61_90,
      coalesce(sum(total) filter (where overdue_days>90),0) as age_over_90
    from open_items
  ), top_clients as (
    select client_id, client_name, sum(total) as overdue_total, count(*) as overdue_count
    from open_items where overdue_days>0 group by client_id,client_name
    order by overdue_total desc,client_id limit 10
  )
  select jsonb_build_object('as_of',today,'portfolio_total',t.portfolio_total,
    'due_soon',t.due_soon,'overdue',t.overdue,'open_count',t.open_count,
    'overdue_count',t.overdue_count,
    'delinquency_percent',case when t.portfolio_total=0 then 0 else round(t.overdue*100/t.portfolio_total,2) end,
    'age_1_30',t.age_1_30,'age_31_60',t.age_31_60,'age_61_90',t.age_61_90,'age_over_90',t.age_over_90,
    'top_clients',coalesce((select jsonb_agg(jsonb_build_object('client_id',x.client_id,'client_name',x.client_name,
      'overdue_total',x.overdue_total,'overdue_count',x.overdue_count) order by x.overdue_total desc,x.client_id) from top_clients x),'[]'::jsonb))
  into result from totals t;
  return result;
end $$;

create function public.list_director_receivables(p_client_id bigint default null, p_area_id bigint default null,
  p_status text default null, p_before_id bigint default null, p_limit integer default 30)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; today date := (now() at time zone 'America/Bogota')::date;
begin
  perform public.statement_require_role('DIRECTOR');
  if p_limit not between 1 and 200 or p_status not in ('ENVIADA','EN_MORA') then
    raise exception 'Filtro o limite de cartera invalido';
  end if;
  with eligible as (
    select s.id,s.client_id,c.name as client_name,a.name as area_name,s.number,s.total,s.sent_date,
      c.credit_days,s.sent_date+c.credit_days as due_date,s.invoice_number,
      greatest(today-(s.sent_date+c.credit_days),0) as days_overdue
    from public.service_statements s join public.clients c on c.id=s.client_id
    join public.area a on a.id=s.area_id
    where s.status='ENVIADA' and (p_client_id is null or s.client_id=p_client_id)
      and (p_area_id is null or s.area_id=p_area_id)
      and (p_before_id is null or s.id<p_before_id)
  ), filtered as (
    select * from eligible where p_status is null
      or (p_status='EN_MORA' and days_overdue>0)
      or (p_status='ENVIADA' and days_overdue=0)
    order by id desc limit p_limit+1
  ), page as (select * from filtered order by id desc limit p_limit)
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object(
    'status',case when p.days_overdue>0 then 'EN_MORA' else 'ENVIADA' end) order by p.id desc) from page p),'[]'::jsonb),
    'has_more',(select count(*)>p_limit from filtered),
    'next_cursor',(select min(id) from page)) into result;
  return result;
end $$;

create function public.get_director_statement_coverage(p_start_date date,p_end_date date,
  p_client_id bigint default null,p_area_id bigint default null,p_operation_type text default null,
  p_before_id bigint default null,p_limit integer default 30)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
  perform public.statement_require_role('DIRECTOR');
  if p_start_date is null or p_end_date is null or p_start_date>p_end_date or p_limit not between 1 and 200 then
    raise exception 'Rango o limite de cobertura invalido';
  end if;
  with closed_operations as (
    select o.id,o.operation_date,o.client_id,c.name as client_name,a.name as area_name,t.code as operation_type,
      exists (select 1 from public.statement_operations so join public.service_statements ss on ss.id=so.statement_id
        where so.operation_id=o.id and so.active and ss.status<>'ANULADA') as assigned,
      case when t.code='TURNO' then not exists(select 1 from public.shift_sales x where x.operation_id=o.id)
        when t.code='DESCARGUE' then not exists(select 1 from public.discharge_sales x where x.operation_id=o.id)
        else true end as missing_sales
    from public.operation o join public.clients c on c.id=o.client_id
    join public.area a on a.id=o.area_id join public.operation_type t on t.id=o.operation_type_id
    where o.status='CERRADO' and o.operation_date between p_start_date and p_end_date
      and (p_client_id is null or o.client_id=p_client_id)
      and (p_area_id is null or o.area_id=p_area_id)
      and (p_operation_type is null or t.code=p_operation_type)
  ), totals as (
    select count(*) as total_closed,count(*) filter(where assigned) as assigned,
      count(*) filter(where not assigned) as unassigned,
      count(*) filter(where missing_sales) as missing_sales from closed_operations
  ), filtered as (
    select * from closed_operations where not assigned and (p_before_id is null or id<p_before_id)
    order by id desc limit p_limit+1
  ), page as (select * from filtered order by id desc limit p_limit)
  select jsonb_build_object('total_closed',t.total_closed,'assigned',t.assigned,'unassigned',t.unassigned,
    'missing_sales',t.missing_sales,'coverage_percent',case when t.total_closed=0 then null
      else round(t.assigned*100.0/t.total_closed,2) end,
    'items',coalesce((select jsonb_agg(to_jsonb(p) order by p.id desc) from page p),'[]'::jsonb),
    'has_more',(select count(*)>p_limit from filtered),'next_cursor',(select min(id) from page))
  into result from totals t;
  return result;
end $$;

revoke all on function public.get_director_receivables_summary(bigint,bigint),
  public.list_director_receivables(bigint,bigint,text,bigint,integer),
  public.get_director_statement_coverage(date,date,bigint,bigint,text,bigint,integer) from public,anon,authenticated;
grant execute on function public.get_director_receivables_summary(bigint,bigint),
  public.list_director_receivables(bigint,bigint,text,bigint,integer),
  public.get_director_statement_coverage(date,date,bigint,bigint,text,bigint,integer) to authenticated;
notify pgrst,'reload schema';
