\set ON_ERROR_STOP on
set test.role='DIRECTOR';
do $$ declare head jsonb; begin
  assert (select statement_city from clients where id=1)='Otra ciudad', 'migrated city';
  assert (select next_statement_number from clients where id=1)=10, 'migrated sequence';
  assert (select credit_days from clients where id=1)=30, 'existing client credit';
  assert to_regclass('public.statement_client_settings') is null, 'legacy settings removed';
  assert get_statement(1)->'header'->>'city'='Bucaramanga', 'existing snapshot preserved';
  assert (statement_settings()->'clients'->0 ? 'next_number'), 'settings reads client fields';
end $$;

set test.role='ADMIN';
do $$ begin
  perform save_admin_client_details(1,'CLIENTE UNO','900-1','Cali',10,0,true);
  assert (select credit_days from clients where id=1)=0, 'cash client';
  begin
    perform save_admin_client_details(1,'CLIENTE UNO','900-1','Cali',9,0,true);
    raise exception 'TEST failed rewind';
  exception when others then if sqlerrm='TEST failed rewind' then raise; end if; end;
  begin
    update clients set next_statement_number=1 where id=1;
    raise exception 'TEST failed direct rewind';
  exception when others then if sqlerrm='TEST failed direct rewind' then raise; end if; end;
  perform save_statement_settings('SUPPORT COLOMBIA','900-1',2,'Medellin',2);
  assert (select statement_city from clients where id=2)='Medellin', 'legacy RPC writes client';
  assert (select next_statement_number from clients where id=2)=2, 'legacy RPC sequence';
  perform save_statement_settings_v2('SUPPORT COLOMBIA','900-1','Gerente',null,2,'Medellin',2);
  assert (select manager_name from statement_issuer where id)='Gerente', 'manager signature config retained';
  perform save_admin_client_details(null,'CLIENTE NUEVO',null,'Girón',1,10,true);
  assert (select credit_days from clients where name='CLIENTE NUEVO')=10, 'new client credit';
end $$;

set test.role='DIRECTOR';
do $$ declare p jsonb; s jsonb; begin
  assert get_statement(1)->'header'->>'city'='Bucaramanga', 'snapshot unaffected by client edit';
  p:=preview_statement(1,1,'2026-01-02','2026-01-02');
  assert p->'header'->>'city'='Cali', 'preview reads clients';
  s:=save_statement(1,1,'2026-01-02','2026-01-02',p->>'preview_hash','after-migration');
  assert s->>'number'='10', 'generation increments clients';
  assert (select next_statement_number from clients where id=1)=11, 'next number persisted in clients';
end $$;

set test.role='COORDINATOR';
do $$ begin
  begin
    perform save_admin_client_details(1,'X',null,'Cali',11,0,true);
    raise exception 'TEST failed role';
  exception when others then if sqlerrm='TEST failed role' then raise; end if; end;
end $$;

set test.role='ADMIN';
update clients set statement_city=null where id=2;
set test.role='DIRECTOR';
do $$ begin
  begin
    perform preview_statement(2,2,'2026-01-01','2026-01-01');
    raise exception 'TEST failed missing city';
  exception when others then if sqlerrm='TEST failed missing city' then raise; end if; end;
end $$;
select 'PASS: client fields, backfill, immutable snapshots, numbering, permissions' result;
