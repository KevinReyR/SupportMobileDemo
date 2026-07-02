-- Store application timestamps as Colombia local wall-clock time.
-- Scope: public schema only. Supabase-managed auth/storage schemas are not changed.

drop function if exists public.get_contractor_documents(bigint);
drop function if exists public.get_contractor_workwear_movements(bigint);

create temp table if not exists public_timestamptz_columns_to_convert (
  table_schema text not null,
  table_name text not null,
  column_name text not null,
  column_default text
) on commit drop;

truncate table public_timestamptz_columns_to_convert;

insert into public_timestamptz_columns_to_convert (
  table_schema,
  table_name,
  column_name,
  column_default
)
select
  c.table_schema,
  c.table_name,
  c.column_name,
  c.column_default
from information_schema.columns c
where c.table_schema = 'public'
  and c.data_type = 'timestamp with time zone';

do $$
declare
  target_column record;
begin
  for target_column in
    select *
    from public_timestamptz_columns_to_convert
    where column_default is not null
  loop
    execute format(
      'alter table %I.%I alter column %I drop default',
      target_column.table_schema,
      target_column.table_name,
      target_column.column_name
    );
  end loop;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = (now() at time zone 'America/Bogota')::timestamp;
  return new;
end;
$$;

drop function if exists public.colombia_now();

create function public.colombia_now()
returns timestamp without time zone
language sql
stable
set search_path = public
as $$
  select (now() at time zone 'America/Bogota')::timestamp;
$$;

create or replace function public.colombia_today()
returns date
language sql
stable
set search_path = public
as $$
  select (now() at time zone 'America/Bogota')::date;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = public.colombia_now();
  return new;
end;
$$;

do $$
declare
  target_column record;
begin
  for target_column in
    select *
    from public_timestamptz_columns_to_convert
  loop
    execute format(
      'alter table %I.%I alter column %I type timestamp without time zone using %I at time zone %L',
      target_column.table_schema,
      target_column.table_name,
      target_column.column_name,
      target_column.column_name,
      'America/Bogota'
    );
  end loop;
end;
$$;

do $$
declare
  target_column record;
begin
  for target_column in
    select *
    from public_timestamptz_columns_to_convert
    where column_default ilike '%now()%'
       or column_default ilike '%colombia_now%'
  loop
    execute format(
      'alter table %I.%I alter column %I set default public.colombia_now()',
      target_column.table_schema,
      target_column.table_name,
      target_column.column_name
    );
  end loop;
end;
$$;

create or replace function public.get_contractor_documents(
  p_contractor_id bigint
)
returns table (
  document_id uuid,
  document_type_code text,
  document_type_name text,
  file_id uuid,
  provider text,
  bucket text,
  path text,
  original_name text,
  mime_type text,
  size_bytes bigint,
  created_at timestamp without time zone,
  updated_at timestamp without time zone
)
language sql
stable
security definer
set search_path = public
as $$
  with latest_by_type as (
    select distinct on (cd.document_type_id)
      cd.id as document_id,
      cdt.code as document_type_code,
      cdt.name as document_type_name,
      af.id as file_id,
      af.provider,
      af.bucket,
      af.path,
      af.original_name,
      af.mime_type,
      af.size_bytes,
      cd.created_at,
      greatest(cd.updated_at, af.updated_at) as updated_at
    from public.contractor_documents cd
    join public.contractor_document_types cdt on cdt.id = cd.document_type_id
    join public.app_files af on af.id = cd.file_id
    where cd.contractor_id = p_contractor_id
      and cdt.is_active
      and af.provider = 'supabase'
      and public.can_access_contractor_documents(p_contractor_id)
    order by cd.document_type_id, greatest(cd.updated_at, af.updated_at) desc, cd.created_at desc, cd.id desc
  )
  select
    document_id,
    document_type_code,
    document_type_name,
    file_id,
    provider,
    bucket,
    path,
    original_name,
    mime_type,
    size_bytes,
    created_at,
    updated_at
  from latest_by_type
  order by document_type_name, updated_at desc, document_id;
$$;

create or replace function public.get_contractor_workwear_movements(
  p_contractor_id bigint
)
returns table (
  movement_id bigint,
  workwear_type_id bigint,
  workwear_type_name text,
  movement_type text,
  movement_date date,
  quantity integer,
  observations text,
  related_delivery_id bigint,
  created_by uuid,
  created_by_name text,
  created_at timestamp without time zone
)
language sql
stable
security definer
set search_path = public
as $$
  select
    cwm.id,
    wt.id,
    wt.name,
    cwm.movement_type,
    cwm.movement_date,
    cwm.quantity,
    cwm.observations,
    cwm.related_delivery_id,
    cwm.created_by,
    trim(coalesce(up.name, '') || ' ' || coalesce(up.last_name, '')) as created_by_name,
    cwm.created_at
  from public.contractor_workwear_movements cwm
  join public.workwear_type wt on wt.id = cwm.workwear_type_id
  left join public.user_profiles up on up.id = cwm.created_by
  where cwm.contractor_id = p_contractor_id
    and (public.has_role('COORDINATOR') or public.has_role('DIRECTOR') or public.has_role('ADMIN'))
  order by cwm.movement_date desc, cwm.id desc;
$$;

revoke execute on function public.get_contractor_documents(bigint)
  from public, anon;
grant execute on function public.get_contractor_documents(bigint)
  to authenticated;

revoke execute on function public.get_contractor_workwear_movements(bigint)
  from public, anon;
grant execute on function public.get_contractor_workwear_movements(bigint)
  to authenticated;

notify pgrst, 'reload schema';
