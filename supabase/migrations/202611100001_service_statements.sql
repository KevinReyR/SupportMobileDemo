-- Service statements reserve operations, never create or change operational sales.
create table public.statement_issuer (
  id boolean primary key default true check (id),
  legal_name text not null check (length(btrim(legal_name)) between 1 and 160),
  nit text not null check (length(btrim(nit)) between 1 and 40),
  updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now()
);
create table public.statement_client_settings (
  client_id bigint primary key references public.clients(id),
  city text not null check (length(btrim(city)) between 1 and 120),
  next_number bigint not null default 1 check (next_number between 1 and 2147483647),
  updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now()
);
create table public.service_statements (
  id bigint generated always as identity primary key,
  client_id bigint not null references public.clients(id), area_id bigint not null references public.area(id),
  number bigint not null, start_date date not null, end_date date not null check (end_date >= start_date),
  status text not null default 'GENERADA' check (status in ('GENERADA','ENVIADA','PAGADA','ANULADA')),
  header jsonb not null, subtotal numeric(18,2) not null check (subtotal >= 0),
  vat_rate numeric not null default 0.19 check (vat_rate = 0.19), vat numeric(18,2) not null, total numeric(18,2) not null,
  sent_date date, paid_date date, invoice_number text, cancellation_reason text,
  request_key text not null unique,
  created_by uuid not null references auth.users(id), updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default clock_timestamp(),
  unique(client_id, number),
  check (vat=round(subtotal*vat_rate,2) and total=subtotal+vat),
  check (status not in ('ENVIADA','PAGADA') or sent_date is not null),
  check (status <> 'PAGADA' or (paid_date >= sent_date and nullif(btrim(invoice_number),'') is not null)),
  check (status <> 'ANULADA' or nullif(btrim(cancellation_reason),'') is not null)
);
create table public.statement_operations (
  statement_id bigint not null references public.service_statements(id),
  operation_id bigint not null references public.operation(id) on delete restrict,
  active boolean not null default true, primary key(statement_id,operation_id)
);
create unique index statement_operation_reserved on public.statement_operations(operation_id) where active;
create table public.statement_lines (
  id bigint generated always as identity primary key,
  statement_id bigint not null references public.service_statements(id),
  operation_id bigint not null references public.operation(id), position integer not null, snapshot jsonb not null,
  unique(statement_id,position)
);
create table public.statement_audit (
  id bigint generated always as identity primary key, statement_id bigint references public.service_statements(id),
  action text not null, before_data jsonb, after_data jsonb,
  actor_id uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create index statement_list_idx on public.service_statements(client_id,status,start_date,id);
create index statement_audit_idx on public.statement_audit(statement_id,id);

do $$ declare t text; begin
  foreach t in array array['statement_issuer','statement_client_settings','service_statements','statement_operations','statement_lines','statement_audit'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
  end loop;
end $$;

create function public.statement_require_role(p_role text) returns void language plpgsql set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or not public.is_active_user() or not public.has_role(p_role) then raise exception 'No autorizado'; end if;
end $$;

create function public.statement_settings() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not (public.has_role('DIRECTOR') or public.has_role('ADMIN')) then raise exception 'No autorizado'; end if;
  return jsonb_build_object('issuer',(select to_jsonb(i) from statement_issuer i),
    'clients',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'city',s.city,'next_number',coalesce(s.next_number,1)) order by c.name)
      from clients c left join statement_client_settings s on s.client_id=c.id),'[]'::jsonb),
    'areas',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'client_id',a.client_id) order by a.name) from area a),'[]'::jsonb));
end $$;

create function public.save_statement_settings(p_legal_name text,p_nit text,p_client_id bigint,p_city text,p_next_number bigint)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare old_data jsonb;
begin
  perform statement_require_role('ADMIN');
  if nullif(btrim(p_legal_name),'') is null or nullif(btrim(p_nit),'') is null then raise exception 'Completa razon social y NIT'; end if;
  -- Same lock order as statement generation: client, then issuer.
  if p_client_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('statement-client:'||p_client_id,0));
    if nullif(btrim(p_city),'') is null or p_next_number is null or p_next_number < 1 then raise exception 'Completa ciudad y consecutivo positivo'; end if;
    if p_next_number <= coalesce((select max(number) from service_statements where client_id=p_client_id),0)
      or p_next_number < coalesce((select next_number from statement_client_settings where client_id=p_client_id),1) then
      raise exception 'El consecutivo no puede retroceder ni reutilizar numeros';
    end if;
  end if;
  old_data:=statement_settings();
  insert into statement_issuer(id,legal_name,nit,updated_by) values(true,btrim(p_legal_name),btrim(p_nit),auth.uid())
  on conflict(id) do update set legal_name=excluded.legal_name,nit=excluded.nit,updated_by=auth.uid(),updated_at=now();
  if p_client_id is not null then
    insert into statement_client_settings(client_id,city,next_number,updated_by) values(p_client_id,btrim(p_city),p_next_number,auth.uid())
    on conflict(client_id) do update set city=excluded.city,next_number=excluded.next_number,updated_by=auth.uid(),updated_at=now();
  end if;
  insert into statement_audit(action,before_data,after_data,actor_id) values('CONFIGURACION',old_data,statement_settings(),auth.uid());
end $$;

-- Internal source; not callable by API roles. Quantities come from materialized sales.
create function public.statement_source(p_client bigint,p_area bigint,p_start date,p_end date,p_self bigint default null)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare lines jsonb; excluded jsonb; head jsonb; sub numeric; missing integer;
begin
  if p_start is null or p_end is null or p_start>p_end then raise exception 'Rango de fechas no valido'; end if;
  if not exists(select 1 from area where id=p_area and client_id=p_client) then raise exception 'Servicio no pertenece al cliente'; end if;
  select jsonb_build_object('issuer_name',i.legal_name,'issuer_nit',i.nit,'client_name',c.name,'city',s.city,'service_name',a.name)
    into head from clients c join statement_client_settings s on s.client_id=c.id
    join area a on a.client_id=c.id and a.id=p_area cross join statement_issuer i where c.id=p_client;
  if p_self is not null then select header into head from service_statements where id=p_self; end if;
  if head is null then raise exception 'Administracion debe configurar emisor, NIT y ciudad del cliente'; end if;
  select count(*) into missing from operation o join operation_type t on t.id=o.operation_type_id
    where o.client_id=p_client and o.area_id=p_area and o.operation_date between p_start and p_end and o.status='CERRADO'
      and not exists(select 1 from statement_operations r where r.operation_id=o.id and r.active and r.statement_id is distinct from p_self)
      and ((t.code='TURNO' and not exists(select 1 from shift_sales s where s.operation_id=o.id))
        or (t.code='DESCARGUE' and not exists(select 1 from discharge_sales s where s.operation_id=o.id)));
  if missing>0 then raise exception 'Hay operaciones cerradas sin ventas materializadas. Revisa antes de generar el acta'; end if;
  if exists(select 1 from operation o join operation_type t on t.id=o.operation_type_id join operation_assignment a on a.operation_id=o.id and a.deleted_at is null
    where o.client_id=p_client and o.area_id=p_area and o.status='CERRADO' and o.operation_date between p_start and p_end
      and not exists(select 1 from statement_operations r where r.operation_id=o.id and r.active and r.statement_id is distinct from p_self)
      and ((t.code='TURNO' and not exists(select 1 from shift_sales s where s.operation_assignment_id=a.id))
        or (t.code='DESCARGUE' and not exists(select 1 from discharge_sales s where s.operation_assignment_id=a.id)))) then
    raise exception 'Hay operaciones con ventas incompletas';
  end if;
  with eligible as (
    select o.* from operation o where o.client_id=p_client and o.area_id=p_area and o.status='CERRADO'
      and o.operation_date between p_start and p_end
      and not exists(select 1 from statement_operations r where r.operation_id=o.id and r.active and r.statement_id is distinct from p_self)
  ), raw as (
    select o.id operation_id,o.operation_date date,'TURNO'::text kind,sh.name unit,
      s.contractor_id,(s.worked_quantity>0) attended,s.worked_quantity quantity,s.unit_shift_sale_price unit_price,
      s.extra_hours,s.unit_extra_hour_sale_price extra_price,s.total_sale
    from eligible o join operation_type t on t.id=o.operation_type_id and t.code='TURNO'
      join shift_sales s on s.operation_id=o.id join shift sh on sh.id=o.shift_id
    union all
    select o.id,o.operation_date,'DESCARGUE',u.name,s.contractor_id,(a.worked_quantity>0),s.discharged_units,s.unit_sale_price,0,0,s.total_sale
    from eligible o join operation_type t on t.id=o.operation_type_id and t.code='DESCARGUE'
      join discharge_sales s on s.operation_id=o.id join service_unit_type u on u.id=s.service_unit_type_id
      join operation_assignment a on a.id=s.operation_assignment_id
  ), grouped as (
    select operation_id,date,kind,unit,count(distinct contractor_id) filter(where attended) auxiliaries,
      sum(quantity) quantity,unit_price,sum(extra_hours) extra_hours,extra_price,sum(total_sale) total,
      (head->>'service_name')||' - '||case when kind='DESCARGUE' then 'Descargue - ' else '' end||unit observations
    from raw group by operation_id,date,kind,unit,unit_price,extra_price
  ) select coalesce(jsonb_agg(to_jsonb(g) order by date,operation_id,unit_price,extra_price),'[]'::jsonb),coalesce(sum(total),0)
    into lines,sub from grouped g;
  select coalesce(jsonb_agg(jsonb_build_object('operation_id',o.id,'date',o.operation_date,'statement_id',s.id,'number',s.number) order by o.operation_date,o.id),'[]'::jsonb)
    into excluded from operation o join statement_operations r on r.operation_id=o.id and r.active
    join service_statements s on s.id=r.statement_id
    where o.client_id=p_client and o.area_id=p_area and o.status='CERRADO' and o.operation_date between p_start and p_end and s.id is distinct from p_self;
  return jsonb_build_object('header',head,'lines',lines,'excluded',excluded,'subtotal',round(sub,2),'vat',round(sub*0.19,2),'total',round(sub,2)+round(sub*0.19,2));
end $$;

create function public.preview_statement(p_client_id bigint,p_area_id bigint,p_start_date date,p_end_date date,p_statement_id bigint default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
  perform statement_require_role('DIRECTOR');
  if p_statement_id is not null and not exists(select 1 from service_statements where id=p_statement_id and client_id=p_client_id and area_id=p_area_id and status='GENERADA') then raise exception 'Acta no editable'; end if;
  result:=statement_source(p_client_id,p_area_id,p_start_date,p_end_date,p_statement_id);
  return result||jsonb_build_object('preview_hash',md5(result::text));
end $$;

create function public.get_statement(p_id bigint) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb;
begin
  perform statement_require_role('DIRECTOR');
  select to_jsonb(s)||jsonb_build_object('lines',coalesce((select jsonb_agg(l.snapshot order by l.position) from statement_lines l where l.statement_id=s.id),'[]'::jsonb),
    'audit',coalesce((select jsonb_agg(jsonb_build_object('action',a.action,'at',a.created_at,'actor',coalesce(u.name,'')||' '||coalesce(u.last_name,''),'before',a.before_data,'after',a.after_data) order by a.id desc)
      from statement_audit a left join user_profiles u on u.id=a.actor_id where a.statement_id=s.id),'[]'::jsonb),
    'days_since_sent',case when sent_date is null then null else coalesce(paid_date,(now() at time zone 'America/Bogota')::date)-sent_date end)
    into r from service_statements s where s.id=p_id;
  if r is null then raise exception 'Acta no encontrada'; end if; return r;
end $$;

create function public.list_statements(p_client_id bigint default null,p_area_id bigint default null,p_status text default null,p_start_date date default null,p_end_date date default null,p_before_id bigint default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform statement_require_role('DIRECTOR');
  if p_start_date>p_end_date then raise exception 'Rango no valido'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by id desc) from (select s.*,
    case when sent_date is null then null else coalesce(paid_date,(now() at time zone 'America/Bogota')::date)-sent_date end days_since_sent
    from service_statements s where (p_client_id is null or client_id=p_client_id) and (p_area_id is null or area_id=p_area_id)
    and (p_status is null or status=p_status) and (p_start_date is null or end_date>=p_start_date)
    and (p_end_date is null or start_date<=p_end_date) and (p_before_id is null or id<p_before_id)
    order by id desc limit 31) x),'[]'::jsonb);
end $$;

create function public.save_statement(p_client_id bigint,p_area_id bigint,p_start_date date,p_end_date date,p_preview_hash text,p_request_key text,p_id bigint default null,p_version timestamptz default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; old service_statements; target bigint; seq bigint;
begin
  perform statement_require_role('DIRECTOR');
  if nullif(btrim(p_request_key),'') is null or length(p_request_key)>160 then raise exception 'Falta identificador de solicitud'; end if;
  perform pg_advisory_xact_lock(hashtextextended('statement-client:'||p_client_id,0));
  if p_id is null then
    select id into target from service_statements where request_key=p_request_key;
    if target is not null then return get_statement(target); end if;
  else
    select * into old from service_statements where id=p_id for update;
    if old.id is null or old.status<>'GENERADA' or old.client_id<>p_client_id or old.area_id<>p_area_id then raise exception 'Acta no editable'; end if;
    if old.updated_at is distinct from p_version then raise exception 'Acta modificada por otro usuario. Recarga'; end if;
  end if;
  perform 1 from operation where client_id=p_client_id and area_id=p_area_id and status='CERRADO' and operation_date between p_start_date and p_end_date order by id for update;
  perform 1 from shift_sales where operation_id in(select id from operation where client_id=p_client_id and area_id=p_area_id and operation_date between p_start_date and p_end_date) for share;
  perform 1 from discharge_sales where operation_id in(select id from operation where client_id=p_client_id and area_id=p_area_id and operation_date between p_start_date and p_end_date) for share;
  perform 1 from statement_issuer for share;
  result:=statement_source(p_client_id,p_area_id,p_start_date,p_end_date,p_id);
  if md5(result::text) is distinct from p_preview_hash then raise exception 'Los datos cambiaron. Actualiza la vista previa antes de confirmar'; end if;
  if jsonb_array_length(result->'lines')=0 then raise exception 'No hay operaciones disponibles para generar el acta'; end if;
  if p_id is null then
    update statement_client_settings set next_number=next_number+1 where client_id=p_client_id returning next_number-1 into seq;
    insert into service_statements(client_id,area_id,number,start_date,end_date,header,subtotal,vat,total,request_key,created_by,updated_by)
      values(p_client_id,p_area_id,seq,p_start_date,p_end_date,result->'header',(result->>'subtotal')::numeric,(result->>'vat')::numeric,(result->>'total')::numeric,p_request_key,auth.uid(),auth.uid()) returning id into target;
  else
    target:=p_id;
    update service_statements set start_date=p_start_date,end_date=p_end_date,subtotal=(result->>'subtotal')::numeric,vat=(result->>'vat')::numeric,total=(result->>'total')::numeric,updated_by=auth.uid(),updated_at=clock_timestamp() where id=target;
    update statement_operations set active=false where statement_id=target;
    delete from statement_lines where statement_id=target;
  end if;
  insert into statement_operations(statement_id,operation_id) select distinct target,(x->>'operation_id')::bigint from jsonb_array_elements(result->'lines') x
    on conflict(statement_id,operation_id) do update set active=true;
  insert into statement_lines(statement_id,operation_id,position,snapshot) select target,(x->>'operation_id')::bigint,n::integer,x from jsonb_array_elements(result->'lines') with ordinality t(x,n);
  insert into statement_audit(statement_id,action,before_data,after_data,actor_id) values(target,case when p_id is null then 'GENERADA' else 'RANGO_ACTUALIZADO' end,to_jsonb(old),result||jsonb_build_object('start_date',p_start_date,'end_date',p_end_date),auth.uid());
  return get_statement(target);
end $$;

create function public.transition_statement(p_id bigint,p_version timestamptz,p_action text,p_date date default null,p_invoice text default null,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare old service_statements; today date:=(now() at time zone 'America/Bogota')::date;
begin
  perform statement_require_role('DIRECTOR');
  select * into old from service_statements where id=p_id for update;
  if old.id is null or old.updated_at is distinct from p_version then raise exception 'Acta modificada o inexistente. Recarga'; end if;
  if old.status in ('PAGADA','ANULADA') then raise exception 'Acta inmutable'; end if;
  if length(coalesce(p_invoice,''))>100 or length(coalesce(p_reason,''))>2000 then raise exception 'Texto demasiado largo'; end if;
  if p_action='ENVIAR' then
    if old.status<>'GENERADA' or p_date is null or p_date>today or p_date<(old.created_at at time zone 'America/Bogota')::date then raise exception 'Fecha de envio o estado no valido'; end if;
    update service_statements set status='ENVIADA',sent_date=p_date where id=p_id;
  elsif p_action='PAGAR' then
    if old.status<>'ENVIADA' or p_date is null or p_date>today or p_date<old.sent_date or nullif(btrim(p_invoice),'') is null then raise exception 'Indica factura y fecha de pago valida, posterior o igual al envio'; end if;
    update service_statements set status='PAGADA',paid_date=p_date,invoice_number=btrim(p_invoice) where id=p_id;
  elsif p_action='FACTURA' then
    if nullif(btrim(p_invoice),'') is null then raise exception 'Indica numero de factura'; end if;
    update service_statements set invoice_number=btrim(p_invoice) where id=p_id;
  elsif p_action='ANULAR' then
    if nullif(btrim(p_reason),'') is null then raise exception 'Indica motivo de anulacion'; end if;
    update service_statements set status='ANULADA',cancellation_reason=btrim(p_reason) where id=p_id;
    update statement_operations set active=false where statement_id=p_id;
  else raise exception 'Accion no valida'; end if;
  update service_statements set updated_by=auth.uid(),updated_at=clock_timestamp() where id=p_id;
  insert into statement_audit(statement_id,action,before_data,after_data,actor_id)
    select p_id,p_action,to_jsonb(old),to_jsonb(s),auth.uid() from service_statements s where id=p_id;
  return get_statement(p_id);
end $$;

revoke all on function public.statement_require_role(text),public.statement_source(bigint,bigint,date,date,bigint) from public,anon,authenticated;
revoke all on function public.statement_settings(),public.save_statement_settings(text,text,bigint,text,bigint),public.preview_statement(bigint,bigint,date,date,bigint),public.get_statement(bigint),public.list_statements(bigint,bigint,text,date,date,bigint),public.save_statement(bigint,bigint,date,date,text,text,bigint,timestamptz),public.transition_statement(bigint,timestamptz,text,date,text,text) from public,anon,authenticated;
grant execute on function public.statement_settings(),public.save_statement_settings(text,text,bigint,text,bigint),public.preview_statement(bigint,bigint,date,date,bigint),public.get_statement(bigint),public.list_statements(bigint,bigint,text,date,date,bigint),public.save_statement(bigint,bigint,date,date,text,text,bigint,timestamptz),public.transition_statement(bigint,timestamptz,text,date,text,text) to authenticated;
notify pgrst,'reload schema';
