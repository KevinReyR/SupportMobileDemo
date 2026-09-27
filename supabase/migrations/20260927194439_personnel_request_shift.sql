alter table public.personnel_request
  add column if not exists shift_id bigint
  references public.shift(id) on update cascade on delete restrict;

create index if not exists personnel_request_shift_id_idx
  on public.personnel_request(shift_id);

comment on column public.personnel_request.shift_id
  is 'Turno solicitado. Nullable para conservar compatibilidad con solicitudes y clientes anteriores.';
