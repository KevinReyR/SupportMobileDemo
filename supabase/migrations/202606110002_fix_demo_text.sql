-- Correct text encoding in the original demo seed.
update public.clients set name = case id
  when 1 then 'Grupo Éxito'
  when 2 then 'Nutresa'
  when 3 then 'Postobón'
end
where id between 1 and 3;

update public.area set name = case id
  when 1 then 'Logística'
  when 2 then 'Bodega'
  when 3 then 'Producción'
  when 4 then 'Empaque'
  when 5 then 'Despachos'
  when 6 then 'Cargue y descargue'
end
where id between 1 and 6;

update public.user_profiles set name = 'Julián', last_name = 'Gómez'
where id = '10000000-0000-0000-0000-000000000003';

update public.contractor set
  name = case id
    when 1 then 'Andrés'
    when 2 then 'Laura'
    when 3 then 'Jhon'
    when 4 then 'Sandra'
    when 5 then 'Camilo'
    when 6 then 'Daniela'
    when 7 then 'Felipe'
    when 8 then 'Natalia'
    when 9 then 'Sebastián'
    when 10 then 'Paola'
    when 11 then 'Mateo'
    when 12 then 'Valentina'
  end,
  last_name = case id
    when 1 then 'Martínez'
    when 2 then 'Castaño'
    when 3 then 'Ramírez'
    when 4 then 'Pérez'
    when 5 then 'Torres'
    when 6 then 'López'
    when 7 then 'Gómez'
    when 8 then 'Ruiz'
    when 9 then 'Mejía'
    when 10 then 'Hernández'
    when 11 then 'Álvarez'
    when 12 then 'Ríos'
  end
where id between 1 and 12;

update public.document_type set
  name = case id when 1 then 'Cédula de ciudadanía' else 'Cédula de extranjería' end;
update public.transport_type set description = 'Transporte propio' where id in (2, 3);
update public.civil_state_type set name = 'Unión libre', description = 'Unión marital' where id = 3;
update public.contract_type set
  name = case id when 1 then 'Obra o labor' else 'Término fijo' end,
  description = case id when 1 then 'Contrato por obra o labor' else 'Contrato a término fijo' end;
update public.attendance_status set
  name = case id when 1 then 'ASISTIÓ' when 2 then 'AUSENTE' else 'INCAPACIDAD' end,
  description = case id when 1 then 'Jornada trabajada' when 2 then 'No asistió' else 'Ausencia justificada' end;
update public.workwear_type set
  name = case id when 1 then 'Camisa' when 2 then 'Pantalón' else 'Calzado' end,
  description = case id when 1 then 'Camisa corporativa' when 2 then 'Pantalón de trabajo' else 'Calzado de seguridad' end;
update public.service_catalog set
  name = case id when 1 then 'Auxiliar de bodega' when 2 then 'Operario de producción' else 'Cargue y descargue' end,
  description = case id when 1 then 'Personal de apoyo logístico' when 2 then 'Personal de línea de producción' else 'Personal para movimiento de mercancía' end;

update public.personnel_request set description = case id
  when 1 then 'Auxiliares con experiencia en picking y packing.'
  when 2 then 'Personal para inventario y organización de bodega.'
  when 3 then 'Operarios para línea de producción.'
  when 4 then 'Personal para turno nocturno de empaque.'
  when 5 then 'Auxiliares de despachos con disponibilidad inmediata.'
  when 6 then 'Personal de cargue y descargue.'
end
where id between 1 and 6;

-- Clients may read assignment rows for their operations, but never pricing or
-- internal observations through PostgREST. Restricted details are exposed by RPC.
revoke select on public.operation_assignment from authenticated;
grant select (
  id,
  operation_id,
  contractor_id,
  planned_quantity,
  worked_quantity,
  attendance_status_id,
  extra_hours,
  created_at,
  updated_at,
  deleted_at
) on public.operation_assignment to authenticated;
