-- Allow at most two shift operations per contractor and day, with an explicit
-- confirmation when a coordinator adds the second one.

create index if not exists operation_assignment_contractor_operation_active_idx
  on public.operation_assignment(contractor_id, operation_id)
  where deleted_at is null;

create index if not exists operation_date_type_idx
  on public.operation(operation_date, operation_type_id, id);

-- Forward declaration so the RPC definitions below are validated in order;
-- the complete implementation replaces this body later in the migration.
create or replace function public.assert_contractor_turno_assignment(
  p_operation_date date,
  p_contractor_id bigint,
  p_exclude_operation_id bigint,
  p_confirmed_second_shift boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  return;
end;
$$;

create or replace function public.check_contractor_shift_assignment(
  p_operation_date date,
  p_contractor_id bigint,
  p_target_client_id bigint,
  p_target_area_id bigint,
  p_target_shift_id bigint,
  p_exclude_operation_id bigint default null
)
returns table(status text, assignments jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  same_operation jsonb;
  discharge_assignments jsonb;
  shift_assignments jsonb;
  shift_count integer;
begin
  if not public.has_role('COORDINATOR')
    or not public.has_client_access(p_target_client_id) then
    raise exception 'No tienes permisos para validar esta asignacion';
  end if;

  if p_operation_date is null or p_contractor_id is null
    or not exists (
      select 1
      from public.area a
      join public.shift s on s.area_id = a.id
      where a.id = p_target_area_id
        and a.client_id = p_target_client_id
        and s.id = p_target_shift_id
    ) then
    raise exception 'La fecha, empresa, area y turno son obligatorios';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'operation_id', o.id,
    'client', coalesce(cl.name, 'Empresa sin nombre'),
    'area', coalesce(a.name, 'Area sin nombre'),
    'shift', coalesce(s.name, 'Turno sin nombre')
  ) order by o.id), '[]'::jsonb)
  into same_operation
  from public.operation_assignment oa
  join public.operation o on o.id = oa.operation_id
  join public.operation_type ot on ot.id = o.operation_type_id and ot.code = 'TURNO'
  left join public.clients cl on cl.id = o.client_id
  left join public.area a on a.id = o.area_id
  left join public.shift s on s.id = o.shift_id
  where oa.contractor_id = p_contractor_id
    and oa.deleted_at is null
    and o.operation_date = p_operation_date
    and o.client_id = p_target_client_id
    and o.area_id = p_target_area_id
    and o.shift_id = p_target_shift_id;

  if jsonb_array_length(same_operation) > 0 then
    return query select 'SAME_OPERATION'::text, same_operation;
    return;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'operation_id', o.id,
    'client', coalesce(cl.name, 'Empresa sin nombre'),
    'area', coalesce(a.name, 'Area sin nombre'),
    'shift', coalesce(sut.name, 'Descargue')
  ) order by o.id), '[]'::jsonb)
  into discharge_assignments
  from public.operation_assignment oa
  join public.operation o on o.id = oa.operation_id
  join public.operation_type ot on ot.id = o.operation_type_id and ot.code = 'DESCARGUE'
  left join public.clients cl on cl.id = o.client_id
  left join public.area a on a.id = o.area_id
  left join public.service_unit_type sut on sut.id = o.service_unit_type_id
  where oa.contractor_id = p_contractor_id
    and oa.deleted_at is null
    and o.operation_date = p_operation_date
    and o.id <> coalesce(p_exclude_operation_id, -1);

  if jsonb_array_length(discharge_assignments) > 0 then
    return query select 'DISCHARGE_CONFLICT'::text, discharge_assignments;
    return;
  end if;

  select count(*)::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'operation_id', o.id,
      'client', coalesce(cl.name, 'Empresa sin nombre'),
      'area', coalesce(a.name, 'Area sin nombre'),
      'shift', coalesce(s.name, 'Turno sin nombre')
    ) order by o.id), '[]'::jsonb)
  into shift_count, shift_assignments
  from public.operation_assignment oa
  join public.operation o on o.id = oa.operation_id
  join public.operation_type ot on ot.id = o.operation_type_id and ot.code = 'TURNO'
  left join public.clients cl on cl.id = o.client_id
  left join public.area a on a.id = o.area_id
  left join public.shift s on s.id = o.shift_id
  where oa.contractor_id = p_contractor_id
    and oa.deleted_at is null
    and o.operation_date = p_operation_date
    and o.id <> coalesce(p_exclude_operation_id, -1);

  if shift_count >= 2 then
    return query select 'LIMIT_REACHED'::text, shift_assignments;
  elsif shift_count = 1 then
    return query select 'CONFIRM_REQUIRED'::text, shift_assignments;
  else
    return query select 'AVAILABLE'::text, '[]'::jsonb;
  end if;
end;
$$;

create or replace function public.enforce_operation_schedule_availability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_type_code text;
  selected_contractor_id bigint;
  contractor_name text;
  other_turnos integer;
begin
  if current_setting('app.operation_schedule_validated', true) = 'true' then
    return new;
  end if;

  select ot.code into new_type_code
  from public.operation_type ot where ot.id = new.operation_type_id;

  for selected_contractor_id in
    select oa.contractor_id from public.operation_assignment oa
    where oa.operation_id = old.id and oa.deleted_at is null
    order by oa.contractor_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      'operation-assignment:' || old.operation_date::text || ':' || selected_contractor_id::text, 0));
    perform pg_advisory_xact_lock(hashtextextended(
      'operation-assignment:' || new.operation_date::text || ':' || selected_contractor_id::text, 0));
    contractor_name := coalesce(public.contractor_display_name(selected_contractor_id), 'El contratista seleccionado');

    if new_type_code = 'TURNO' then
      if exists (
        select 1 from public.operation_assignment oa
        join public.operation o on o.id = oa.operation_id
        join public.operation_type ot on ot.id = o.operation_type_id
        where oa.contractor_id = selected_contractor_id and oa.deleted_at is null
          and o.id <> new.id and o.operation_date = new.operation_date and ot.code = 'DESCARGUE'
      ) then
        raise exception '% ya esta asignado a un descargue en esta fecha', contractor_name;
      end if;
      select count(*)::integer into other_turnos
      from public.operation_assignment oa
      join public.operation o on o.id = oa.operation_id
      join public.operation_type ot on ot.id = o.operation_type_id
      where oa.contractor_id = selected_contractor_id and oa.deleted_at is null
        and o.id <> new.id and o.operation_date = new.operation_date and ot.code = 'TURNO';
      if other_turnos >= 2 then
        raise exception '% ya tiene dos turnos en esta fecha', contractor_name;
      end if;
    elsif new_type_code = 'DESCARGUE' and exists (
      select 1 from public.operation_assignment oa
      join public.operation o on o.id = oa.operation_id
      join public.operation_type ot on ot.id = o.operation_type_id
      where oa.contractor_id = selected_contractor_id and oa.deleted_at is null
        and o.id <> new.id and o.operation_date = new.operation_date and ot.code = 'TURNO'
    ) then
      raise exception '% ya esta asignado a una operacion de turno en esta fecha', contractor_name;
    end if;
  end loop;
  return new;
end;
$$;

revoke execute on function public.enforce_operation_schedule_availability()
  from public, anon, authenticated;

drop trigger if exists operation_schedule_enforce_availability on public.operation;
create trigger operation_schedule_enforce_availability
before update of operation_date, operation_type_id on public.operation
for each row execute function public.enforce_operation_schedule_availability();

create or replace function public.update_in_progress_operation_v2(
  p_operation_id bigint,
  p_operation_date date,
  p_client_id bigint,
  p_area_id bigint,
  p_operation_type_code text,
  p_shift_id bigint,
  p_service_unit_type_id bigint,
  p_planned_units numeric,
  p_contractor_ids bigint[],
  p_confirmed_second_shift_contractor_ids bigint[] default '{}'::bigint[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  target record;
  normalized_type text := upper(trim(coalesce(p_operation_type_code, '')));
  new_operation_type_id bigint;
  new_client_name text;
  new_area_name text;
  new_shift_name text;
  new_service_unit_name text;
  rate_sale_price numeric;
  rate_cost_price numeric;
  current_contractor_ids bigint[] := '{}'::bigint[];
  desired_contractor_ids bigint[] := '{}'::bigint[];
  selected_contractor_id bigint;
  selected_contractor_name text;
  actor_name text;
  change_group uuid := gen_random_uuid();
  change_count integer := 0;
  has_header_changes boolean;
begin
  select o.*, cl.name as old_client_name, a.name as old_area_name,
    ot.code as old_operation_type_code, ot.name as old_operation_type_name,
    s.name as old_shift_name, sut.name as old_service_unit_name
  into target
  from public.operation o
  join public.clients cl on cl.id = o.client_id
  join public.area a on a.id = o.area_id
  join public.operation_type ot on ot.id = o.operation_type_id
  left join public.shift s on s.id = o.shift_id
  left join public.service_unit_type sut on sut.id = o.service_unit_type_id
  where o.id = p_operation_id
  for update of o;

  if target.id is null or target.status <> 'EN_CURSO'
    or not public.has_role('COORDINATOR')
    or not public.has_client_access(target.client_id)
    or not public.has_client_access(p_client_id) then
    raise exception 'La operacion no se puede editar';
  end if;
  if p_operation_date is null then raise exception 'La fecha de la operacion es obligatoria'; end if;
  if normalized_type not in ('TURNO', 'DESCARGUE') then raise exception 'El tipo de operacion no es valido'; end if;
  if p_contractor_ids is null or cardinality(p_contractor_ids) = 0 then
    raise exception 'Debes asignar al menos un contratista';
  end if;
  if exists (select 1 from unnest(p_contractor_ids) ids(id) where id is null)
    or exists (select 1 from unnest(p_contractor_ids) ids(id) group by id having count(*) > 1) then
    raise exception 'No puedes agregar el mismo contratista dos veces';
  end if;

  select ot.id into new_operation_type_id
  from public.operation_type ot where ot.code = normalized_type and ot.is_active;
  if new_operation_type_id is null then raise exception 'El tipo de operacion no esta disponible'; end if;
  select cl.name into new_client_name from public.clients cl where cl.id = p_client_id and cl.is_active;
  if new_client_name is null then raise exception 'El cliente seleccionado no esta disponible'; end if;
  select a.name into new_area_name from public.area a
  where a.id = p_area_id and a.client_id = p_client_id and a.is_active;
  if new_area_name is null then raise exception 'El area seleccionada no pertenece al cliente'; end if;

  if normalized_type = 'TURNO' then
    select s.name into new_shift_name from public.shift s
    where s.id = p_shift_id and s.area_id = p_area_id and s.is_active;
    if new_shift_name is null then raise exception 'El turno seleccionado no pertenece al area'; end if;
    select sale_price, cost_price into rate_sale_price, rate_cost_price
    from public.current_shift_rate(p_shift_id, p_operation_date);
    if rate_sale_price is null or rate_cost_price is null then
      raise exception 'La tarifa del turno no esta configurada para la fecha seleccionada';
    end if;
    if exists (
      select 1 from public.operation o
      join public.operation_type ot on ot.id = o.operation_type_id
      where o.id <> p_operation_id and o.operation_date = p_operation_date
        and o.client_id = p_client_id and o.area_id = p_area_id
        and o.shift_id = p_shift_id and ot.code = 'TURNO'
    ) then
      raise exception 'Ya existe una operacion para % - % - % en esta fecha',
        new_client_name, new_area_name, new_shift_name;
    end if;
  else
    if p_planned_units is null or p_planned_units <= 0 or p_planned_units <> round(p_planned_units, 2) then
      raise exception 'Las unidades planeadas deben ser positivas y tener maximo dos decimales';
    end if;
    select sut.name into new_service_unit_name from public.service_unit_type sut
    where sut.id = p_service_unit_type_id and sut.is_active;
    if new_service_unit_name is null then raise exception 'El tipo de unidad no esta disponible'; end if;
    select sale_price, cost_price into rate_sale_price, rate_cost_price
    from public.current_service_unit_rate(p_area_id, p_service_unit_type_id, p_operation_date);
    if rate_sale_price is null or rate_cost_price is null then
      raise exception 'La tarifa del tipo de unidad no esta configurada para el area y la fecha';
    end if;
  end if;

  select coalesce(array_agg(oa.contractor_id order by oa.contractor_id), '{}'::bigint[])
  into current_contractor_ids from public.operation_assignment oa
  where oa.operation_id = p_operation_id and oa.deleted_at is null;
  desired_contractor_ids := array(select id from unnest(p_contractor_ids) ids(id) order by id);

  has_header_changes := target.operation_date is distinct from p_operation_date
    or target.client_id is distinct from p_client_id
    or target.area_id is distinct from p_area_id
    or target.old_operation_type_code is distinct from normalized_type
    or (normalized_type = 'TURNO' and target.shift_id is distinct from p_shift_id)
    or (normalized_type = 'DESCARGUE' and (
      target.service_unit_type_id is distinct from p_service_unit_type_id
      or target.planned_units is distinct from p_planned_units));

  if not has_header_changes and current_contractor_ids is not distinct from desired_contractor_ids then
    return 0;
  end if;

  perform oa.id from public.operation_assignment oa
  where oa.operation_id = p_operation_id for update;
  for selected_contractor_id in
    select distinct id from unnest(current_contractor_ids || desired_contractor_ids) ids(id) order by id
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      'operation-assignment:' || target.operation_date::text || ':' || selected_contractor_id::text, 0));
    perform pg_advisory_xact_lock(hashtextextended(
      'operation-assignment:' || p_operation_date::text || ':' || selected_contractor_id::text, 0));
  end loop;

  for selected_contractor_id in select id from unnest(desired_contractor_ids) ids(id)
  loop
    selected_contractor_name := coalesce(public.contractor_display_name(selected_contractor_id), 'El contratista seleccionado');
    if not public.contractor_has_active_contract(selected_contractor_id) then
      raise exception '% no tiene contrato activo y no puede asignarse a la operacion', selected_contractor_name;
    end if;
    if normalized_type = 'TURNO' then
      if has_header_changes or not (selected_contractor_id = any(current_contractor_ids)) then
        perform public.assert_contractor_turno_assignment(
          p_operation_date, selected_contractor_id, p_operation_id,
          selected_contractor_id = any(coalesce(p_confirmed_second_shift_contractor_ids, '{}'::bigint[]))
        );
      end if;
    elsif exists (
      select 1 from public.operation_assignment oa
      join public.operation o on o.id = oa.operation_id
      join public.operation_type ot on ot.id = o.operation_type_id
      where oa.contractor_id = selected_contractor_id and oa.deleted_at is null
        and o.id <> p_operation_id and o.operation_date = p_operation_date and ot.code = 'TURNO'
    ) then
      raise exception '% ya esta asignado a una operacion de turno en esta fecha', selected_contractor_name;
    end if;
  end loop;

  perform set_config('app.operation_schedule_validated', 'true', true);
  update public.operation
  set operation_date = p_operation_date, client_id = p_client_id, area_id = p_area_id,
      operation_type_id = new_operation_type_id,
      shift_id = case when normalized_type = 'TURNO' then p_shift_id else null end,
      service_unit_type_id = case when normalized_type = 'DESCARGUE' then p_service_unit_type_id else null end,
      planned_units = case when normalized_type = 'DESCARGUE' then p_planned_units else null end,
      actual_units = null,
      unit_sale_price_snapshot = case when normalized_type = 'DESCARGUE' then rate_sale_price else null end,
      unit_cost_price_snapshot = case when normalized_type = 'DESCARGUE' then rate_cost_price else null end,
      updated_at = public.colombia_now()
  where id = p_operation_id;

  update public.operation_assignment oa
  set deleted_at = public.colombia_now(), updated_at = public.colombia_now()
  where oa.operation_id = p_operation_id and oa.deleted_at is null
    and not (oa.contractor_id = any(desired_contractor_ids));

  update public.operation_assignment oa
  set planned_quantity = 1, worked_quantity = 0, attendance_status_id = null,
      extra_hours = 0, discharged_units = null, unit_sale_price = rate_sale_price,
      unit_cost_price = rate_cost_price, unit_extra_hour_cost_price = null,
      total_sale = 0, total_cost = 0, observations = null,
      verification_observations = null, updated_at = public.colombia_now()
  where oa.operation_id = p_operation_id and oa.deleted_at is null
    and oa.contractor_id = any(desired_contractor_ids);

  insert into public.operation_assignment(
    operation_id, contractor_id, planned_quantity, worked_quantity,
    attendance_status_id, extra_hours, discharged_units, unit_sale_price,
    unit_cost_price, total_sale, total_cost, observations, planned_by
  )
  select p_operation_id, desired_id, 1, 0, null, 0, null,
    rate_sale_price, rate_cost_price, 0, 0, null, auth.uid()
  from unnest(desired_contractor_ids) desired_id
  where not exists (
    select 1 from public.operation_assignment oa
    where oa.operation_id = p_operation_id and oa.contractor_id = desired_id and oa.deleted_at is null
  );

  select trim(concat_ws(' ', up.name, up.last_name)) into actor_name
  from public.user_profiles up where up.id = auth.uid();
  actor_name := coalesce(nullif(actor_name, ''), 'Coordinador');

  if target.operation_date is distinct from p_operation_date then
    insert into public.operation_change_history(operation_id, change_group_id, change_type, description,
      old_value, new_value, changed_by, changed_by_name)
    values (p_operation_id, change_group, 'DATE_CHANGED',
      format('La fecha cambio de %s a %s', to_char(target.operation_date, 'DD/MM/YYYY'), to_char(p_operation_date, 'DD/MM/YYYY')),
      jsonb_build_object('date', target.operation_date), jsonb_build_object('date', p_operation_date), auth.uid(), actor_name);
    change_count := change_count + 1;
  end if;
  if target.client_id is distinct from p_client_id then
    insert into public.operation_change_history(operation_id, change_group_id, change_type, description,
      old_value, new_value, changed_by, changed_by_name)
    values (p_operation_id, change_group, 'CLIENT_CHANGED',
      format('El cliente cambio de %s a %s', target.old_client_name, new_client_name),
      jsonb_build_object('id', target.client_id, 'name', target.old_client_name),
      jsonb_build_object('id', p_client_id, 'name', new_client_name), auth.uid(), actor_name);
    change_count := change_count + 1;
  end if;
  if target.area_id is distinct from p_area_id then
    insert into public.operation_change_history(operation_id, change_group_id, change_type, description,
      old_value, new_value, changed_by, changed_by_name)
    values (p_operation_id, change_group, 'AREA_CHANGED',
      format('El area cambio de %s a %s', target.old_area_name, new_area_name),
      jsonb_build_object('id', target.area_id, 'name', target.old_area_name),
      jsonb_build_object('id', p_area_id, 'name', new_area_name), auth.uid(), actor_name);
    change_count := change_count + 1;
  end if;
  if target.old_operation_type_code is distinct from normalized_type then
    insert into public.operation_change_history(operation_id, change_group_id, change_type, description,
      old_value, new_value, changed_by, changed_by_name)
    values (p_operation_id, change_group, 'OPERATION_TYPE_CHANGED',
      format('El tipo de operacion cambio de %s a %s', target.old_operation_type_name,
        case when normalized_type = 'TURNO' then 'Turno' else 'Descargue' end),
      jsonb_build_object('code', target.old_operation_type_code, 'name', target.old_operation_type_name),
      jsonb_build_object('code', normalized_type), auth.uid(), actor_name);
    change_count := change_count + 1;
  end if;
  if normalized_type = 'TURNO' and (target.old_operation_type_code is distinct from normalized_type
    or target.shift_id is distinct from p_shift_id) then
    insert into public.operation_change_history(operation_id, change_group_id, change_type, description,
      old_value, new_value, changed_by, changed_by_name)
    values (p_operation_id, change_group, 'SHIFT_CHANGED',
      format('El turno cambio de %s a %s', coalesce(target.old_shift_name, 'Sin turno'), new_shift_name),
      jsonb_build_object('id', target.shift_id, 'name', target.old_shift_name),
      jsonb_build_object('id', p_shift_id, 'name', new_shift_name), auth.uid(), actor_name);
    change_count := change_count + 1;
  end if;
  if normalized_type = 'DESCARGUE' and (target.old_operation_type_code is distinct from normalized_type
    or target.service_unit_type_id is distinct from p_service_unit_type_id) then
    insert into public.operation_change_history(operation_id, change_group_id, change_type, description,
      old_value, new_value, changed_by, changed_by_name)
    values (p_operation_id, change_group, 'SERVICE_UNIT_TYPE_CHANGED',
      format('El tipo de unidad cambio de %s a %s', coalesce(target.old_service_unit_name, 'Sin unidad'), new_service_unit_name),
      jsonb_build_object('id', target.service_unit_type_id, 'name', target.old_service_unit_name),
      jsonb_build_object('id', p_service_unit_type_id, 'name', new_service_unit_name), auth.uid(), actor_name);
    change_count := change_count + 1;
  end if;
  if normalized_type = 'DESCARGUE' and (target.old_operation_type_code is distinct from normalized_type
    or target.planned_units is distinct from p_planned_units) then
    insert into public.operation_change_history(operation_id, change_group_id, change_type, description,
      old_value, new_value, changed_by, changed_by_name)
    values (p_operation_id, change_group, 'PLANNED_UNITS_CHANGED',
      format('Las unidades planeadas cambiaron de %s a %s', coalesce(target.planned_units, 0), p_planned_units),
      jsonb_build_object('units', target.planned_units), jsonb_build_object('units', p_planned_units), auth.uid(), actor_name);
    change_count := change_count + 1;
  end if;
  for selected_contractor_id in
    select id from unnest(desired_contractor_ids) ids(id) where not (id = any(current_contractor_ids))
  loop
    selected_contractor_name := public.contractor_display_name(selected_contractor_id);
    insert into public.operation_change_history(operation_id, change_group_id, change_type, description,
      old_value, new_value, changed_by, changed_by_name)
    values (p_operation_id, change_group, 'CONTRACTOR_ADDED',
      format('Se anadio el contratista %s', selected_contractor_name), null,
      jsonb_build_object('id', selected_contractor_id, 'name', selected_contractor_name), auth.uid(), actor_name);
    change_count := change_count + 1;
  end loop;
  for selected_contractor_id in
    select id from unnest(current_contractor_ids) ids(id) where not (id = any(desired_contractor_ids))
  loop
    selected_contractor_name := public.contractor_display_name(selected_contractor_id);
    insert into public.operation_change_history(operation_id, change_group_id, change_type, description,
      old_value, new_value, changed_by, changed_by_name)
    values (p_operation_id, change_group, 'CONTRACTOR_REMOVED',
      format('Se elimino al contratista %s', selected_contractor_name),
      jsonb_build_object('id', selected_contractor_id, 'name', selected_contractor_name), null, auth.uid(), actor_name);
    change_count := change_count + 1;
  end loop;
  return change_count;
end;
$$;

revoke execute on function public.update_in_progress_operation_v2(
  bigint,date,bigint,bigint,text,bigint,bigint,numeric,bigint[],bigint[]
) from public, anon;
grant execute on function public.update_in_progress_operation_v2(
  bigint,date,bigint,bigint,text,bigint,bigint,numeric,bigint[],bigint[]
) to authenticated;

create or replace function public.create_operation_with_assignments(
  p_operation_date date,
  p_client_id bigint,
  p_area_id bigint,
  p_shift_id bigint,
  p_assignments jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_operation_id bigint;
  assignment_item jsonb;
  selected_contractor_id bigint;
  selected_contractor_name text;
  target_client_name text;
  target_area_name text;
  target_shift_name text;
  rate_sale_price numeric;
  rate_cost_price numeric;
begin
  if not public.has_role('COORDINATOR') or not public.has_client_access(p_client_id) then
    raise exception 'No tienes permisos para crear esta operacion';
  end if;
  if p_operation_date is null then raise exception 'La fecha de la operacion es obligatoria'; end if;
  if p_assignments is null or jsonb_typeof(p_assignments) <> 'array'
    or jsonb_array_length(p_assignments) = 0 then
    raise exception 'Debes asignar al menos un contratista';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_assignments) assignment
    group by assignment ->> 'contractor_id' having count(*) > 1
  ) then
    raise exception 'No puedes agregar el mismo contratista dos veces';
  end if;

  select cl.name, a.name, s.name
  into target_client_name, target_area_name, target_shift_name
  from public.clients cl
  join public.area a on a.client_id = cl.id and a.id = p_area_id
  join public.shift s on s.area_id = a.id and s.id = p_shift_id and s.is_active
  where cl.id = p_client_id;
  if target_shift_name is null then raise exception 'El turno seleccionado no pertenece al area'; end if;

  select sale_price, cost_price into rate_sale_price, rate_cost_price
  from public.current_shift_rate(p_shift_id, p_operation_date);
  if rate_sale_price is null or rate_cost_price is null then
    raise exception 'La tarifa del turno no esta configurada';
  end if;

  if exists (
    select 1 from public.operation o
    where o.operation_date = p_operation_date and o.client_id = p_client_id
      and o.area_id = p_area_id and o.shift_id = p_shift_id
  ) then
    raise exception 'Ya existe una operacion para % - % - % en esta fecha. Abre el detalle de la operacion existente para continuar.',
      target_client_name, target_area_name, target_shift_name;
  end if;

  for assignment_item in select * from jsonb_array_elements(p_assignments)
  loop
    selected_contractor_id := (assignment_item ->> 'contractor_id')::bigint;
    selected_contractor_name := coalesce(public.contractor_display_name(selected_contractor_id), 'El contratista seleccionado');
    if not public.contractor_has_active_contract(selected_contractor_id) then
      raise exception '% no tiene contrato activo y no puede asignarse a la operacion', selected_contractor_name;
    end if;
    perform public.assert_contractor_turno_assignment(
      p_operation_date,
      selected_contractor_id,
      null,
      coalesce((assignment_item ->> 'confirmed_second_shift')::boolean, false)
    );
  end loop;

  insert into public.operation(operation_date, client_id, area_id, shift_id, created_by, status)
  values (p_operation_date, p_client_id, p_area_id, p_shift_id, auth.uid(), 'EN_CURSO')
  returning id into new_operation_id;

  insert into public.operation_assignment(
    operation_id, contractor_id, planned_quantity, unit_sale_price, unit_cost_price, planned_by
  )
  select new_operation_id, (assignment ->> 'contractor_id')::bigint,
    coalesce((assignment ->> 'planned_quantity')::numeric, 1),
    rate_sale_price, rate_cost_price, auth.uid()
  from jsonb_array_elements(p_assignments) assignment;
  return new_operation_id;
exception
  when unique_violation then
    raise exception 'Ya existe una operacion para % - % - % en esta fecha. Abre el detalle de la operacion existente para continuar.',
      coalesce(target_client_name, 'este cliente'), coalesce(target_area_name, 'esta area'),
      coalesce(target_shift_name, 'este turno');
end;
$$;

create or replace function public.finalize_operation(
  p_operation_id bigint,
  p_assignments jsonb,
  p_observations text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  assignment_item jsonb;
  target_date date;
  target_area_id bigint;
  target_shift_id bigint;
  selected_contractor_id bigint;
  selected_assignment_id bigint;
  selected_contractor_name text;
  selected_worked_quantity numeric;
  selected_extra_hours numeric;
  rate_sale_price numeric;
  rate_cost_price numeric;
  extra_hour_sale_price numeric;
  extra_hour_cost_price numeric;
begin
  select o.operation_date, o.area_id, o.shift_id
  into target_date, target_area_id, target_shift_id
  from public.operation o
  join public.operation_type ot on ot.id = o.operation_type_id
  where o.id = p_operation_id and ot.code = 'TURNO'
    and o.status in ('EN_CURSO', 'CAMBIOS_SOLICITADOS')
    and public.has_role('COORDINATOR') and public.has_client_access(o.client_id)
  for update;
  if target_date is null then raise exception 'La operacion no se puede finalizar'; end if;

  select sale_price, cost_price into rate_sale_price, rate_cost_price
  from public.current_shift_rate(target_shift_id, target_date);
  if rate_sale_price is null or rate_cost_price is null then
    raise exception 'La tarifa del turno no esta configurada';
  end if;
  select sale_price, cost_price into extra_hour_sale_price, extra_hour_cost_price
  from public.current_area_extra_hour_rate(target_area_id, target_date);
  if extra_hour_sale_price is null then
    raise exception 'El precio de venta de la hora extra del area no esta configurado';
  end if;
  if extra_hour_cost_price is null then
    raise exception 'El precio de costo de la hora extra del area no esta configurado';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_assignments) item
    group by item ->> 'contractor_id' having count(*) > 1
  ) then
    raise exception 'No puedes agregar el mismo contratista dos veces';
  end if;

  for assignment_item in select * from jsonb_array_elements(p_assignments)
  loop
    selected_assignment_id := nullif(assignment_item ->> 'assignment_id', '')::bigint;
    selected_contractor_id := (assignment_item ->> 'contractor_id')::bigint;
    selected_worked_quantity := coalesce((assignment_item ->> 'worked_quantity')::numeric, 0);
    selected_extra_hours := coalesce((assignment_item ->> 'extra_hours')::numeric, 0);
    selected_contractor_name := coalesce(public.contractor_display_name(selected_contractor_id), 'El contratista seleccionado');
    if selected_extra_hours < 0 then raise exception 'Las horas extra no pueden ser negativas'; end if;
    if not public.contractor_has_active_contract(selected_contractor_id) then
      raise exception '% no tiene contrato activo y no puede asignarse a la operacion', selected_contractor_name;
    end if;

    if selected_assignment_id is null then
      perform public.assert_contractor_turno_assignment(
        target_date, selected_contractor_id, p_operation_id,
        coalesce((assignment_item ->> 'confirmed_second_shift')::boolean, false)
      );
      insert into public.operation_assignment(
        operation_id, contractor_id, planned_quantity, worked_quantity,
        attendance_status_id, extra_hours, unit_sale_price, unit_cost_price,
        unit_extra_hour_cost_price, total_sale, total_cost, observations, planned_by
      ) values (
        p_operation_id, selected_contractor_id, 1, selected_worked_quantity,
        (assignment_item ->> 'attendance_status_id')::bigint, selected_extra_hours,
        rate_sale_price, rate_cost_price, extra_hour_cost_price,
        (selected_worked_quantity * rate_sale_price) + (selected_extra_hours * extra_hour_sale_price),
        (selected_worked_quantity * rate_cost_price) + (selected_extra_hours * extra_hour_cost_price),
        nullif(assignment_item ->> 'observations', ''), auth.uid()
      );
    else
      update public.operation_assignment
      set attendance_status_id = (assignment_item ->> 'attendance_status_id')::bigint,
          worked_quantity = selected_worked_quantity,
          extra_hours = selected_extra_hours,
          unit_sale_price = rate_sale_price,
          unit_cost_price = rate_cost_price,
          unit_extra_hour_cost_price = extra_hour_cost_price,
          total_sale = (selected_worked_quantity * rate_sale_price) + (selected_extra_hours * extra_hour_sale_price),
          total_cost = (selected_worked_quantity * rate_cost_price) + (selected_extra_hours * extra_hour_cost_price),
          observations = nullif(assignment_item ->> 'observations', ''),
          updated_at = public.colombia_now()
      where id = selected_assignment_id and contractor_id = selected_contractor_id
        and operation_id = p_operation_id and deleted_at is null;
      if not found then raise exception 'La asignacion del contratista no es valida'; end if;
    end if;
  end loop;

  update public.operation
  set status = 'PENDIENTE', observations = p_observations,
      review_observations = null, verify_by = null, verify_at = null
  where id = p_operation_id;
end;
$$;

revoke execute on function public.check_contractor_shift_assignment(date,bigint,bigint,bigint,bigint,bigint)
  from public, anon;
grant execute on function public.check_contractor_shift_assignment(date,bigint,bigint,bigint,bigint,bigint)
  to authenticated;

create or replace function public.assert_contractor_turno_assignment(
  p_operation_date date,
  p_contractor_id bigint,
  p_exclude_operation_id bigint,
  p_confirmed_second_shift boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  contractor_name text := coalesce(public.contractor_display_name(p_contractor_id), 'El contratista seleccionado');
  existing_shift_count integer;
  existing_details text;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('operation-assignment:' || p_operation_date::text || ':' || p_contractor_id::text, 0)
  );

  if exists (
    select 1
    from public.operation_assignment oa
    join public.operation o on o.id = oa.operation_id
    join public.operation_type ot on ot.id = o.operation_type_id
    where oa.contractor_id = p_contractor_id
      and oa.deleted_at is null
      and o.operation_date = p_operation_date
      and o.id <> coalesce(p_exclude_operation_id, -1)
      and ot.code = 'DESCARGUE'
  ) then
    raise exception '% ya esta asignado a un descargue en esta fecha', contractor_name;
  end if;

  select count(*)::integer,
    string_agg(format('%s / %s / %s', coalesce(cl.name, 'Empresa sin nombre'),
      coalesce(a.name, 'Area sin nombre'), coalesce(s.name, 'Turno sin nombre')), '; ' order by o.id)
  into existing_shift_count, existing_details
  from public.operation_assignment oa
  join public.operation o on o.id = oa.operation_id
  join public.operation_type ot on ot.id = o.operation_type_id and ot.code = 'TURNO'
  left join public.clients cl on cl.id = o.client_id
  left join public.area a on a.id = o.area_id
  left join public.shift s on s.id = o.shift_id
  where oa.contractor_id = p_contractor_id
    and oa.deleted_at is null
    and o.operation_date = p_operation_date
    and o.id <> coalesce(p_exclude_operation_id, -1);

  if existing_shift_count >= 2 then
    raise exception '% ya tiene dos turnos en esta fecha: %', contractor_name, existing_details;
  end if;
  if existing_shift_count = 1 and not coalesce(p_confirmed_second_shift, false) then
    raise exception '% ya esta asignado a %. Confirma expresamente la asignacion al segundo turno.',
      contractor_name, existing_details;
  end if;
end;
$$;

revoke execute on function public.assert_contractor_turno_assignment(date,bigint,bigint,boolean)
  from public, anon, authenticated;

create or replace function public.enforce_operation_assignment_availability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_date date;
  target_type_code text;
  contractor_name text;
  other_turnos integer;
begin
  select o.operation_date, ot.code
  into target_date, target_type_code
  from public.operation o
  join public.operation_type ot on ot.id = o.operation_type_id
  where o.id = new.operation_id;

  if target_date is null then raise exception 'La operacion seleccionada no existe'; end if;

  perform pg_advisory_xact_lock(
    hashtextextended('operation-assignment:' || target_date::text || ':' || new.contractor_id::text, 0)
  );
  if new.deleted_at is not null then return new; end if;

  contractor_name := coalesce(public.contractor_display_name(new.contractor_id), 'El contratista seleccionado');
  if not public.contractor_has_active_contract(new.contractor_id) then
    raise exception '% no tiene contrato activo y no puede asignarse a la operacion', contractor_name;
  end if;

  if target_type_code = 'TURNO' then
    if exists (
      select 1 from public.operation_assignment oa
      join public.operation o on o.id = oa.operation_id
      join public.operation_type ot on ot.id = o.operation_type_id
      where oa.contractor_id = new.contractor_id and oa.deleted_at is null
        and oa.id <> coalesce(new.id, -1) and o.id <> new.operation_id
        and o.operation_date = target_date and ot.code = 'DESCARGUE'
    ) then
      raise exception '% ya esta asignado a un descargue en esta fecha', contractor_name;
    end if;

    select count(*)::integer into other_turnos
    from public.operation_assignment oa
    join public.operation o on o.id = oa.operation_id
    join public.operation_type ot on ot.id = o.operation_type_id
    where oa.contractor_id = new.contractor_id and oa.deleted_at is null
      and oa.id <> coalesce(new.id, -1) and o.id <> new.operation_id
      and o.operation_date = target_date and ot.code = 'TURNO';
    if other_turnos >= 2 then
      raise exception '% ya tiene dos turnos en esta fecha', contractor_name;
    end if;
  elsif target_type_code = 'DESCARGUE' and exists (
    select 1 from public.operation_assignment oa
    join public.operation o on o.id = oa.operation_id
    join public.operation_type ot on ot.id = o.operation_type_id
    where oa.contractor_id = new.contractor_id and oa.deleted_at is null
      and oa.id <> coalesce(new.id, -1) and o.id <> new.operation_id
      and o.operation_date = target_date and ot.code = 'TURNO'
  ) then
    raise exception '% ya esta asignado a una operacion de turno en esta fecha', contractor_name;
  end if;
  return new;
end;
$$;

create or replace function public.get_available_contractors_for_operation(p_operation_id bigint)
returns table(contractor_id bigint)
language sql
stable
security definer
set search_path = public
as $$
  select c.id
  from public.contractor c
  join public.operation target on target.id = p_operation_id
  where public.has_role('COORDINATOR')
    and public.has_client_access(target.client_id)
    and target.status in ('EN_CURSO', 'CAMBIOS_SOLICITADOS')
    and public.contractor_has_active_contract(c.id)
    and not exists (
      select 1 from public.operation_assignment oa
      join public.operation o on o.id = oa.operation_id
      join public.operation_type ot on ot.id = o.operation_type_id
      where oa.contractor_id = c.id and oa.deleted_at is null
        and o.id <> target.id and o.operation_date = target.operation_date
        and ot.code = 'DESCARGUE'
    )
    and 2 > (
      select count(*) from public.operation_assignment oa
      join public.operation o on o.id = oa.operation_id
      join public.operation_type ot on ot.id = o.operation_type_id
      where oa.contractor_id = c.id and oa.deleted_at is null
        and o.id <> target.id and o.operation_date = target.operation_date
        and ot.code = 'TURNO'
    )
  order by c.name, c.last_name;
$$;

create or replace function public.get_available_contractors_for_operation_edit(
  p_operation_id bigint,
  p_operation_date date,
  p_operation_type_code text
)
returns table(contractor_id bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target_operation record;
  normalized_type text := upper(trim(coalesce(p_operation_type_code, '')));
begin
  select o.id, o.client_id, o.status into target_operation
  from public.operation o where o.id = p_operation_id;
  if target_operation.id is null or target_operation.status <> 'EN_CURSO'
    or not public.has_role('COORDINATOR') or not public.has_client_access(target_operation.client_id) then
    raise exception 'La operacion no se puede editar';
  end if;
  if p_operation_date is null or normalized_type not in ('TURNO', 'DESCARGUE') then
    raise exception 'La fecha y el tipo de operacion son obligatorios';
  end if;

  return query
  select c.id from public.contractor c
  where public.contractor_has_active_contract(c.id)
    and not exists (
      select 1 from public.operation_assignment oa
      join public.operation o on o.id = oa.operation_id
      join public.operation_type ot on ot.id = o.operation_type_id
      where oa.contractor_id = c.id and oa.deleted_at is null
        and o.id <> p_operation_id and o.operation_date = p_operation_date
        and ((normalized_type = 'TURNO' and ot.code = 'DESCARGUE')
          or (normalized_type = 'DESCARGUE' and ot.code = 'TURNO'))
    )
    and (normalized_type = 'DESCARGUE' or 2 > (
      select count(*) from public.operation_assignment oa
      join public.operation o on o.id = oa.operation_id
      join public.operation_type ot on ot.id = o.operation_type_id
      where oa.contractor_id = c.id and oa.deleted_at is null
        and o.id <> p_operation_id and o.operation_date = p_operation_date
        and ot.code = 'TURNO'
    ))
  order by c.name, c.last_name;
end;
$$;

revoke execute on function public.create_operation_with_assignments(date,bigint,bigint,bigint,jsonb)
  from public, anon;
grant execute on function public.create_operation_with_assignments(date,bigint,bigint,bigint,jsonb)
  to authenticated;
revoke execute on function public.finalize_operation(bigint,jsonb,text) from public, anon;
grant execute on function public.finalize_operation(bigint,jsonb,text) to authenticated;

notify pgrst, 'reload schema';
