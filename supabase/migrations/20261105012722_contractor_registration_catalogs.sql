create table public.pension_funds (
  id bigint generated always as identity primary key,
  name text not null unique,
  is_active boolean not null default true
);
alter table public.pension_funds enable row level security;
revoke all on public.pension_funds from anon, authenticated;
grant select on public.pension_funds to authenticated;
create policy internal_read on public.pension_funds for select to authenticated
using (public.has_role('ADMIN') or public.has_role('DIRECTOR') or public.has_role('COORDINATOR'));
insert into public.pension_funds(name) values ('PORVENIR'), ('PROTECCION'), ('COLFONDOS'), ('SKANDIA'), ('COLPENSIONES')
on conflict (name) do nothing;

create table public.health_insurers (
  id bigint generated always as identity primary key,
  name text not null unique,
  is_active boolean not null default true
);
alter table public.health_insurers enable row level security;
revoke all on public.health_insurers from anon, authenticated;
grant select on public.health_insurers to authenticated;
create policy internal_read on public.health_insurers for select to authenticated
using (public.has_role('ADMIN') or public.has_role('DIRECTOR') or public.has_role('COORDINATOR'));
insert into public.health_insurers(name) values ('SANITAS'), ('EPS SURA'), ('SALUD TOTAL'), ('NUEVA EPS'), ('COOSALUD'), ('FAMISANAR'), ('EMSSANAR'), ('MUTUAL SER'), ('ALIANSALUD'), ('OTRA EPS')
on conflict (name) do nothing;

create or replace function public.create_contractor_draft_with_details(
  p_document_type_id bigint,
  p_document_number text,
  p_name text,
  p_last_name text,
  p_phone_number text,
  p_email text,
  p_birth_date date,
  p_residence_department text,
  p_residence_city text,
  p_neighborhood text,
  p_address text,
  p_pension_fund text,
  p_eps text
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_contractor_id bigint;
begin
  if (select auth.uid()) is null
    or not (public.has_role('COORDINATOR') or public.has_role('DIRECTOR')) then
    raise exception 'No autorizado';
  end if;

  if nullif(btrim(p_residence_department), '') is null
    or nullif(btrim(p_residence_city), '') is null
    or nullif(btrim(p_neighborhood), '') is null
    or nullif(btrim(p_address), '') is null
    or nullif(btrim(p_pension_fund), '') is null
    or nullif(btrim(p_eps), '') is null then
    raise exception 'Completa departamento, ciudad, barrio, direccion, fondo de pensiones y EPS';
  end if;

  if p_phone_number is null or btrim(p_phone_number) !~ '^3[0-9]{9}$' then
    raise exception 'Telefono: ingresa 10 digitos comenzando por 3. Ejemplo: 3001234567';
  end if;
  if p_email is null or btrim(p_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Correo: ingresa una direccion como elcorreo@dominio.com';
  end if;
  p_name := upper(btrim(p_name));
  p_last_name := upper(btrim(p_last_name));
  p_phone_number := btrim(p_phone_number);
  p_email := lower(btrim(p_email));
  select name into p_pension_fund from public.pension_funds where name = upper(btrim(p_pension_fund)) and is_active;
  if p_pension_fund is null then raise exception 'Fondo de pensiones: selecciona una opcion activa del catalogo'; end if;
  select name into p_eps from public.health_insurers where name = upper(btrim(p_eps)) and is_active;
  if p_eps is null then raise exception 'EPS: selecciona una opcion activa del catalogo'; end if;

  new_contractor_id := public.create_contractor_draft(
    p_document_type_id, p_document_number, p_name, p_last_name,
    p_phone_number, p_email, p_birth_date
  );

  update public.contractor
  set residence_department = btrim(p_residence_department),
      residence_city = btrim(p_residence_city),
      neighborhood = upper(btrim(p_neighborhood)),
      address = btrim(p_address),
      pension_fund = btrim(p_pension_fund),
      eps = btrim(p_eps)
  where id = new_contractor_id;

  return new_contractor_id;
end;
$$;

revoke all on function public.create_contractor_draft_with_details(bigint,text,text,text,text,text,date,text,text,text,text,text,text) from public, anon;
grant execute on function public.create_contractor_draft_with_details(bigint,text,text,text,text,text,date,text,text,text,text,text,text) to authenticated;

create or replace function public.complete_contractor_registration_details(
  p_contractor_id bigint,
  p_residence_department text,
  p_residence_city text,
  p_neighborhood text,
  p_address text,
  p_pension_fund text,
  p_eps text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (select auth.uid()) is null
    or not (public.has_role('COORDINATOR') or public.has_role('DIRECTOR')) then
    raise exception 'No autorizado';
  end if;

  if nullif(btrim(p_residence_department), '') is null
    or nullif(btrim(p_residence_city), '') is null
    or nullif(btrim(p_neighborhood), '') is null
    or nullif(btrim(p_address), '') is null
    or nullif(btrim(p_pension_fund), '') is null
    or nullif(btrim(p_eps), '') is null then
    raise exception 'Completa departamento, ciudad, barrio, direccion, fondo de pensiones y EPS';
  end if;

  select name into p_pension_fund from public.pension_funds where name = upper(btrim(p_pension_fund)) and is_active;
  if p_pension_fund is null then raise exception 'Fondo de pensiones: selecciona una opcion activa del catalogo'; end if;
  select name into p_eps from public.health_insurers where name = upper(btrim(p_eps)) and is_active;
  if p_eps is null then raise exception 'EPS: selecciona una opcion activa del catalogo'; end if;

  update public.contractor
  set residence_department = btrim(p_residence_department),
      residence_city = btrim(p_residence_city),
      neighborhood = upper(btrim(p_neighborhood)),
      address = btrim(p_address),
      pension_fund = btrim(p_pension_fund),
      eps = btrim(p_eps)
  where id = p_contractor_id;

  if not found then
    raise exception 'Contratista no encontrado';
  end if;
end;
$$;

revoke all on function public.complete_contractor_registration_details(bigint,text,text,text,text,text,text) from public, anon;
grant execute on function public.complete_contractor_registration_details(bigint,text,text,text,text,text,text) to authenticated;
