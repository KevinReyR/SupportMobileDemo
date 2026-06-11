-- Harden function execution and normalize demo text using ASCII-safe escapes.

alter function public.set_updated_at() set search_path = public;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

revoke execute on function public.is_active_user() from public, anon;
revoke execute on function public.has_role(text) from public, anon;
revoke execute on function public.has_client_access(bigint) from public, anon;
revoke execute on function public.get_operation_assignments(bigint) from public, anon;
revoke execute on function public.get_contractor_history(bigint) from public, anon;

grant execute on function public.is_active_user() to authenticated;
grant execute on function public.has_role(text) to authenticated;
grant execute on function public.has_client_access(bigint) to authenticated;
grant execute on function public.get_operation_assignments(bigint) to authenticated;
grant execute on function public.get_contractor_history(bigint) to authenticated;

update public.clients set name = case id
  when 1 then U&'Grupo \00C9xito'
  when 2 then 'Nutresa'
  when 3 then U&'Postob\00F3n'
end
where id between 1 and 3;

update public.area set name = case id
  when 1 then U&'Log\00EDstica'
  when 2 then 'Bodega'
  when 3 then U&'Producci\00F3n'
  when 4 then 'Empaque'
  when 5 then 'Despachos'
  when 6 then 'Cargue y descargue'
end
where id between 1 and 6;

update public.user_profiles
set name = U&'Juli\00E1n', last_name = U&'G\00F3mez'
where id = '10000000-0000-0000-0000-000000000003';

update public.contractor set
  name = case id
    when 1 then U&'Andr\00E9s'
    when 2 then 'Laura'
    when 3 then 'Jhon'
    when 4 then 'Sandra'
    when 5 then 'Camilo'
    when 6 then 'Daniela'
    when 7 then 'Felipe'
    when 8 then 'Natalia'
    when 9 then U&'Sebasti\00E1n'
    when 10 then 'Paola'
    when 11 then 'Mateo'
    when 12 then 'Valentina'
  end,
  last_name = case id
    when 1 then U&'Mart\00EDnez'
    when 2 then U&'Casta\00F1o'
    when 3 then U&'Ram\00EDrez'
    when 4 then U&'P\00E9rez'
    when 5 then 'Torres'
    when 6 then U&'L\00F3pez'
    when 7 then U&'G\00F3mez'
    when 8 then 'Ruiz'
    when 9 then U&'Mej\00EDa'
    when 10 then U&'Hern\00E1ndez'
    when 11 then U&'\00C1lvarez'
    when 12 then U&'R\00EDos'
  end
where id between 1 and 12;

update public.document_type set
  name = case id
    when 1 then U&'C\00E9dula de ciudadan\00EDa'
    else U&'C\00E9dula de extranjer\00EDa'
  end;

update public.civil_state_type
set name = U&'Uni\00F3n libre', description = U&'Uni\00F3n marital'
where id = 3;

update public.contract_type set
  name = case id when 1 then 'Obra o labor' else U&'T\00E9rmino fijo' end,
  description = case id
    when 1 then 'Contrato por obra o labor'
    else U&'Contrato a t\00E9rmino fijo'
  end;

update public.attendance_status set
  name = case id when 1 then U&'ASISTI\00D3' when 2 then 'AUSENTE' else 'INCAPACIDAD' end,
  description = case id
    when 1 then 'Jornada trabajada'
    when 2 then U&'No asisti\00F3'
    else 'Ausencia justificada'
  end;

update public.workwear_type set
  name = case id when 1 then 'Camisa' when 2 then U&'Pantal\00F3n' else 'Calzado' end,
  description = case id
    when 1 then 'Camisa corporativa'
    when 2 then U&'Pantal\00F3n de trabajo'
    else 'Calzado de seguridad'
  end;

update public.service_catalog set
  name = case id
    when 1 then 'Auxiliar de bodega'
    when 2 then U&'Operario de producci\00F3n'
    else 'Cargue y descargue'
  end,
  description = case id
    when 1 then U&'Personal de apoyo log\00EDstico'
    when 2 then U&'Personal de l\00EDnea de producci\00F3n'
    else U&'Personal para movimiento de mercanc\00EDa'
  end;

update public.personnel_request set description = case id
  when 1 then 'Auxiliares con experiencia en picking y packing.'
  when 2 then U&'Personal para inventario y organizaci\00F3n de bodega.'
  when 3 then U&'Operarios para l\00EDnea de producci\00F3n.'
  when 4 then 'Personal para turno nocturno de empaque.'
  when 5 then 'Auxiliares de despachos con disponibilidad inmediata.'
  when 6 then 'Personal de cargue y descargue.'
end
where id between 1 and 6;
