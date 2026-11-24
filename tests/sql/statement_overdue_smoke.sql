\set ON_ERROR_STOP on
set test.role='ADMIN';
update clients set credit_days=2 where id=1;

-- Newer generated actas must not hide older overdue ones from a filtered page.
insert into service_statements(client_id,area_id,number,start_date,end_date,status,header,subtotal,vat,total,sent_date,request_key,created_by,updated_by)
select 1,1,1000+g,'2026-01-01','2026-01-01','ENVIADA',
  (select header from service_statements where id=1),0,0,0,
  (now() at time zone 'America/Bogota')::date-3,'mora-'||g,auth.uid(),auth.uid()
from generate_series(1,36) g;
insert into service_statements(client_id,area_id,number,start_date,end_date,status,header,subtotal,vat,total,sent_date,request_key,created_by,updated_by)
select 1,1,2000,'2026-01-01','2026-01-01','ENVIADA',
  (select header from service_statements where id=1),0,0,0,
  (now() at time zone 'America/Bogota')::date-2,'mora-boundary',auth.uid(),auth.uid();
insert into service_statements(client_id,area_id,number,start_date,end_date,status,header,subtotal,vat,total,request_key,created_by,updated_by)
select 1,1,3000+g,'2026-01-01','2026-01-01','GENERADA',
  (select header from service_statements where id=1),0,0,0,'generated-'||g,auth.uid(),auth.uid()
from generate_series(1,35) g;

set test.role='DIRECTOR';
do $$ declare
  today date := (now() at time zone 'America/Bogota')::date;
  id_mora bigint := (select id from service_statements where request_key='mora-1');
  id_cancel bigint := (select id from service_statements where request_key='mora-2');
  id_boundary bigint := (select id from service_statements where request_key='mora-boundary');
  item jsonb; page1 jsonb; page2 jsonb;
begin
  item:=get_statement_v2(id_mora);
  assert item->>'status'='EN_MORA', 'first day after due date';
  assert (item->>'due_date')::date=today-1 and (item->>'days_overdue')::int=1, 'due date and days overdue';
  assert (item->>'credit_days')::int=2 and (item->>'days_since_sent')::int=3, 'current credit and elapsed days';
  assert get_statement(id_mora)->>'status'='ENVIADA', 'old RPC remains compatible';
  assert (select status from service_statements where id=id_mora)='ENVIADA', 'stored status unchanged';
  assert get_statement_v2(id_boundary)->>'status'='ENVIADA', 'due date is not overdue';

  page1:=list_statements_v2(1,null,'EN_MORA');
  assert jsonb_array_length(page1)=31, 'overdue filter applied before page limit';
  page2:=list_statements_v2(1,null,'EN_MORA',null,null,(page1->29->>'id')::bigint);
  assert jsonb_array_length(page2)=6, 'cursor finds remaining overdue actas';
  assert (select count(distinct (x->>'id')::bigint) from jsonb_array_elements(page1) x)=31, 'unique first page';
  assert (select bool_and(x->>'status'='EN_MORA') from jsonb_array_elements(page2) x), 'filtered page status';
  assert (select bool_and(x->>'status'='ENVIADA') from jsonb_array_elements(list_statements_v2(1,null,'ENVIADA')) x), 'enviada filter excludes mora';

  perform transition_statement(id_mora,(item->>'updated_at')::timestamptz,'PAGAR',today,'F-MORA');
  assert get_statement_v2(id_mora)->>'status'='PAGADA', 'overdue payment';
  item:=get_statement_v2(id_cancel);
  perform transition_statement(id_cancel,(item->>'updated_at')::timestamptz,'ANULAR',null,null,'Prueba');
  assert get_statement_v2(id_cancel)->>'status'='ANULADA', 'overdue cancellation';
end $$;

set test.role='ADMIN';
update clients set credit_days=4 where id=1;
set test.role='DIRECTOR';
do $$ declare
  id_mora bigint := (select id from service_statements where request_key='mora-3');
  id_paid bigint := (select id from service_statements where request_key='mora-1');
  id_cancel bigint := (select id from service_statements where request_key='mora-2');
begin
  assert get_statement_v2(id_mora)->>'status'='ENVIADA', 'credit extension removes mora';
  assert jsonb_array_length(list_statements_v2(1,null,'EN_MORA'))=0, 'filter uses current credit';
  assert get_statement_v2(id_paid)->>'status'='PAGADA', 'payment is final after credit change';
  assert get_statement_v2(id_cancel)->>'status'='ANULADA', 'cancellation is final after credit change';
end $$;

set test.role='ADMIN';
update clients set credit_days=0 where id=1;
update service_statements set sent_date=(now() at time zone 'America/Bogota')::date where request_key='mora-boundary';
set test.role='DIRECTOR';
do $$ declare id_boundary bigint := (select id from service_statements where request_key='mora-boundary'); begin
  assert get_statement_v2(id_boundary)->>'status'='ENVIADA', 'cash payment due on send day';
end $$;
set test.role='ADMIN';
update service_statements set sent_date=(now() at time zone 'America/Bogota')::date-1 where request_key='mora-boundary';
set test.role='DIRECTOR';
do $$ declare id_boundary bigint := (select id from service_statements where request_key='mora-boundary'); begin
  assert get_statement_v2(id_boundary)->>'status'='EN_MORA', 'cash payment overdue next day';
end $$;

set test.role='CLIENT';
do $$ begin
  begin perform get_statement_v2(1); raise exception 'TEST failed client detail';
  exception when others then if sqlerrm='TEST failed client detail' then raise; end if; end;
  begin perform list_statements_v2(); raise exception 'TEST failed client list';
  exception when others then if sqlerrm='TEST failed client list' then raise; end if; end;
end $$;
select 'PASS: overdue boundary, credit changes, transitions, paging, compatibility and permissions' result;
