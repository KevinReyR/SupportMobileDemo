-- Update operational shift names to the final journey catalog.

update public.shift
set name = case name
  when 'Mañana' then 'Diurno'
  when 'Tarde' then 'Nocturno'
  when 'Completa' then 'Festivos'
  when 'Mixto Diurno' then 'Medio Diurno'
  when 'Mixto Nocturno' then 'Medio Nocturno'
  else name
end,
updated_at = public.colombia_now()
where name in ('Mañana', 'Tarde', 'Completa', 'Mixto Diurno', 'Mixto Nocturno');

insert into public.shift(area_id, name, is_active)
select a.id, final_shift.name, true
from public.area a
cross join (
  values
    ('Diurno'),
    ('Nocturno'),
    ('Festivos'),
    ('Medio Diurno'),
    ('Medio Nocturno')
) as final_shift(name)
where a.is_active
on conflict (area_id, name) do update set
  is_active = true,
  updated_at = public.colombia_now();

select setval(
  pg_get_serial_sequence('public.service_rates', 'id'),
  greatest(
    coalesce((select max(id) from public.service_rates), 0),
    (select last_value from public.service_rates_id_seq)
  ),
  true
);

insert into public.service_rates(
  shift_id,
  sale_price,
  cost_price,
  valid_from,
  valid_to
)
select
  target_shift.id,
  base_rate.sale_price,
  base_rate.cost_price,
  base_rate.valid_from,
  base_rate.valid_to
from public.shift target_shift
join lateral (
  select sr.sale_price, sr.cost_price, sr.valid_from, sr.valid_to
  from public.service_rates sr
  join public.shift source_shift on source_shift.id = sr.shift_id
  where source_shift.area_id = target_shift.area_id
  order by
    case source_shift.name
      when 'Festivos' then 0
      when 'Diurno' then 1
      when 'Nocturno' then 2
      else 3
    end,
    sr.valid_from desc,
    sr.id desc
  limit 1
) base_rate on true
where target_shift.name in ('Medio Diurno', 'Medio Nocturno')
  and not exists (
    select 1
    from public.service_rates existing
    where existing.shift_id = target_shift.id
  );

do $$
declare
  missing_count integer;
begin
  select count(*)
  into missing_count
  from public.area a
  cross join (
    values
      ('Diurno'),
      ('Nocturno'),
      ('Festivos'),
      ('Medio Diurno'),
      ('Medio Nocturno')
  ) as final_shift(name)
  left join public.shift s on s.area_id = a.id and s.name = final_shift.name and s.is_active
  where a.is_active
    and s.id is null;

  if missing_count > 0 then
    raise exception 'No se configuraron todas las jornadas finales por area';
  end if;
end;
$$;

notify pgrst, 'reload schema';
