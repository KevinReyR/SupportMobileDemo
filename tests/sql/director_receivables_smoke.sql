\set ON_ERROR_STOP on
set test.role='ADMIN';
update clients set credit_days=2 where id=1;
insert into operation(id,client_id,area_id,operation_date,status,operation_type_id,shift_id)
values(5,1,1,'2026-01-02','CERRADO',1,1);
-- A paid statement and a generated statement must never enter open receivables.
insert into service_statements(client_id,area_id,number,start_date,end_date,status,header,subtotal,vat,total,sent_date,paid_date,invoice_number,request_key,created_by,updated_by)
select 1,1,9001,'2026-01-01','2026-01-01','PAGADA',header,100,19,119,
  (now() at time zone 'America/Bogota')::date-10,(now() at time zone 'America/Bogota')::date-1,'F1','paid-test',auth.uid(),auth.uid()
from service_statements where id=1;
insert into service_statements(client_id,area_id,number,start_date,end_date,status,header,subtotal,vat,total,request_key,created_by,updated_by)
select 1,1,9002,'2026-01-01','2026-01-01','GENERADA',header,100,19,119,'generated-test',auth.uid(),auth.uid()
from service_statements where id=1;
-- One overdue and one due today, with nonzero gross balances.
insert into service_statements(client_id,area_id,number,start_date,end_date,status,header,subtotal,vat,total,sent_date,request_key,created_by,updated_by)
select 1,1,9003,'2026-01-01','2026-01-01','ENVIADA',header,100,19,119,
  (now() at time zone 'America/Bogota')::date-3,'overdue-test',auth.uid(),auth.uid()
from service_statements where id=1;
insert into service_statements(client_id,area_id,number,start_date,end_date,status,header,subtotal,vat,total,sent_date,request_key,created_by,updated_by)
select 1,1,9004,'2026-01-01','2026-01-01','ENVIADA',header,200,38,238,
  (now() at time zone 'America/Bogota')::date-2,'due-test',auth.uid(),auth.uid()
from service_statements where id=1;
set test.role='DIRECTOR';
do $$ declare s jsonb; p jsonb; p2 jsonb; c jsonb; begin
  s:=get_director_receivables_summary(1,1);
  assert (s->>'portfolio_total')::numeric>=357, 'gross open portfolio';
  assert (s->>'overdue')::numeric>=119, 'overdue balance';
  assert (s->>'due_soon')::numeric>=238, 'due-today balance';
  assert (s->>'portfolio_total')::numeric=(s->>'due_soon')::numeric+(s->>'overdue')::numeric, 'portfolio reconciles';
  assert (s->>'overdue')::numeric=(s->>'age_1_30')::numeric+(s->>'age_31_60')::numeric+
    (s->>'age_61_90')::numeric+(s->>'age_over_90')::numeric, 'aging reconciles';
  p:=list_director_receivables(1,1,'EN_MORA',null,200);
  assert exists(select 1 from jsonb_array_elements(p->'items') x where (x->>'number')::int=9003), 'overdue in filtered list';
  assert not exists(select 1 from jsonb_array_elements(p->'items') x where (x->>'number')::int in (9001,9002,9004)), 'exclude paid, generated and due';
  p:=list_director_receivables(1,1,'EN_MORA',null,30);
  assert jsonb_array_length(p->'items')=30 and (p->>'has_more')::boolean, 'first page and more';
  p2:=list_director_receivables(1,1,'EN_MORA',(p->>'next_cursor')::bigint,30);
  assert not exists(select 1 from jsonb_array_elements(p2->'items') x
    where (x->>'id')::bigint in (select (y->>'id')::bigint from jsonb_array_elements(p->'items') y)), 'cursor without duplicates';
  c:=get_director_statement_coverage('2026-01-01','2026-01-03');
  assert (c->>'total_closed')::int=4 and (c->>'assigned')::int=2 and (c->>'unassigned')::int=2, 'closed-only coverage';
  assert (c->>'missing_sales')::int=1, 'detect absent materialized sale';
  assert jsonb_array_length(c->'items')=2, 'unassigned detail';
end $$;
set test.role='ADMIN';
insert into statement_operations(statement_id,operation_id,active)
select id,5,true from service_statements where request_key='generated-test';
set test.role='DIRECTOR';
do $$ declare c jsonb; begin
  c:=get_director_statement_coverage('2026-01-01','2026-01-03',1,1,'TURNO');
  assert (c->>'total_closed')::int=2 and (c->>'assigned')::int=2, 'generated acta reserves operation';
  assert (c->>'missing_sales')::int=1, 'closed operation without sale';
end $$;
set test.role='ADMIN';
update service_statements set status='ANULADA',cancellation_reason='Prueba' where request_key='generated-test';
update statement_operations set active=false where operation_id=5;
set test.role='DIRECTOR';
do $$ declare c jsonb; begin
  c:=get_director_statement_coverage('2026-01-01','2026-01-03',1,1,'TURNO');
  assert (c->>'assigned')::int=1 and (c->>'unassigned')::int=1, 'annulment releases operation';
end $$;
set test.role='CLIENT';
do $$ begin
  begin perform get_director_receivables_summary(); raise exception 'client saw cartera';
  exception when others then if sqlerrm='client saw cartera' then raise; end if; end;
  begin perform get_director_statement_coverage('2026-01-01','2026-01-31'); raise exception 'client saw coverage';
  exception when others then if sqlerrm='client saw coverage' then raise; end if; end;
end $$;
select 'PASS: receivables, overdue, coverage, sales gaps and permissions' result;
