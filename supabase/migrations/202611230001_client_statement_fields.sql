-- Move statement configuration to its owning client. Existing statement snapshots remain unchanged.
alter table public.clients
  add column statement_city text,
  add column next_statement_number bigint not null default 1,
  add column credit_days integer not null default 30,
  add constraint clients_statement_city_check check (statement_city is null or length(btrim(statement_city)) between 1 and 120),
  add constraint clients_next_statement_number_check check (next_statement_number between 1 and 2147483647),
  add constraint clients_credit_days_check check (credit_days >= 0);

update public.clients c
set statement_city=s.city,
    next_statement_number=greatest(s.next_number,coalesce((select max(a.number)+1 from public.service_statements a where a.client_id=c.id),1))
from public.statement_client_settings s where s.client_id=c.id;

update public.clients c set next_statement_number=coalesce((select max(a.number)+1 from public.service_statements a where a.client_id=c.id),1)
where not exists(select 1 from public.statement_client_settings s where s.client_id=c.id);

create function public.prevent_statement_number_rewind() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.next_statement_number < old.next_statement_number
     or new.next_statement_number <= coalesce((select max(number) from public.service_statements where client_id=new.id),0) then
    raise exception 'El consecutivo no puede retroceder ni reutilizar numeros';
  end if;
  return new;
end $$;
create trigger clients_statement_number_guard before update of next_statement_number on public.clients
for each row execute function public.prevent_statement_number_rewind();

create or replace function public.statement_settings() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or not public.is_active_user() or not (public.has_role('DIRECTOR') or public.has_role('ADMIN')) then raise exception 'No autorizado'; end if;
  return jsonb_build_object('issuer',(select to_jsonb(i) from statement_issuer i),
    'clients',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'city',c.statement_city,'next_number',c.next_statement_number) order by c.name) from clients c),'[]'::jsonb),
    'areas',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'client_id',a.client_id) order by a.name) from area a),'[]'::jsonb));
end $$;

create or replace function public.save_statement_settings(p_legal_name text,p_nit text,p_client_id bigint,p_city text,p_next_number bigint)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare old_data jsonb;
begin
  perform public.statement_require_role('ADMIN');
  if nullif(btrim(p_legal_name),'') is null or nullif(btrim(p_nit),'') is null then raise exception 'Completa razon social y NIT'; end if;
  -- Preserve the old signature for open browser sessions; all client writes now target clients.
  if p_client_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('statement-client:'||p_client_id,0));
    if nullif(btrim(p_city),'') is null or p_next_number is null or p_next_number < 1 then raise exception 'Completa ciudad y consecutivo positivo'; end if;
    update clients set statement_city=btrim(p_city),next_statement_number=p_next_number where id=p_client_id;
    if not found then raise exception 'Cliente no encontrado'; end if;
  end if;
  old_data:=statement_settings();
  insert into statement_issuer(id,legal_name,nit,updated_by) values(true,btrim(p_legal_name),btrim(p_nit),auth.uid())
  on conflict(id) do update set legal_name=excluded.legal_name,nit=excluded.nit,updated_by=auth.uid(),updated_at=now();
  insert into statement_audit(action,before_data,after_data,actor_id) values('CONFIGURACION',old_data,statement_settings(),auth.uid());
end $$;

create function public.save_admin_client_details(p_id bigint,p_name text,p_document_number text,p_statement_city text,p_next_statement_number bigint,p_credit_days integer,p_is_active boolean)
returns bigint language plpgsql security definer set search_path=public,pg_temp as $$
declare result bigint;
begin
  perform public.statement_require_role('ADMIN');
  if nullif(btrim(p_name),'') is null or nullif(btrim(p_statement_city),'') is null or length(btrim(p_statement_city))>120
     or p_next_statement_number is null or p_next_statement_number<1 or p_next_statement_number>2147483647
     or p_credit_days is null or p_credit_days<0 or p_is_active is null then
    raise exception 'Completa nombre, ciudad, consecutivo y dias de credito validos';
  end if;
  if p_id is null then
    insert into clients(name,document_number,statement_city,next_statement_number,credit_days,is_active)
    values(btrim(p_name),nullif(btrim(p_document_number),''),btrim(p_statement_city),p_next_statement_number,p_credit_days,p_is_active)
    returning id into result;
  else
    perform pg_advisory_xact_lock(hashtextextended('statement-client:'||p_id,0));
    update clients set name=btrim(p_name),document_number=nullif(btrim(p_document_number),''),
      statement_city=btrim(p_statement_city),next_statement_number=p_next_statement_number,credit_days=p_credit_days,is_active=p_is_active
    where id=p_id returning id into result;
    if result is null then raise exception 'Cliente no encontrado'; end if;
  end if;
  return result;
end $$;

create or replace function public.statement_source(p_client bigint,p_area bigint,p_start date,p_end date,p_self bigint default null)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare lines jsonb; excluded jsonb; head jsonb; sub numeric; missing integer;
begin
  if p_start is null or p_end is null or p_start>p_end then raise exception 'Rango de fechas no valido'; end if;
  if not exists(select 1 from area where id=p_area and client_id=p_client) then raise exception 'Servicio no pertenece al cliente'; end if;
  select jsonb_build_object('issuer_name',i.legal_name,'issuer_nit',i.nit,'client_name',c.name,'city',c.statement_city,'service_name',a.name)
    into head from clients c join area a on a.client_id=c.id and a.id=p_area cross join statement_issuer i
    where c.id=p_client and nullif(btrim(c.statement_city),'') is not null;
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

create or replace function public.save_statement(p_client_id bigint,p_area_id bigint,p_start_date date,p_end_date date,p_preview_hash text,p_request_key text,p_id bigint default null,p_version timestamptz default null)
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
    update clients set next_statement_number=next_statement_number+1 where id=p_client_id and next_statement_number<2147483647
      returning next_statement_number-1 into seq;
    if seq is null then raise exception 'Consecutivo agotado o cliente no encontrado'; end if;
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

revoke all on function public.save_admin_client_details(bigint,text,text,text,bigint,integer,boolean) from public,anon;
grant execute on function public.save_admin_client_details(bigint,text,text,text,bigint,integer,boolean) to authenticated;
revoke all on function public.prevent_statement_number_rewind() from public,anon,authenticated;
drop table public.statement_client_settings;
notify pgrst,'reload schema';
