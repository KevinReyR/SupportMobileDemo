update public.transport_type
set name = 'Vehículo',
    description = 'Vehículo particular'
where name = 'No';

notify pgrst, 'reload schema';
