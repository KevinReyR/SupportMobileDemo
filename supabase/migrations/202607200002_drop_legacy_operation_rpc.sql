-- The pre-shift overload is no longer used and still references client_service_id.
drop function if exists public.create_operation_with_assignments(date,bigint,bigint,jsonb);

notify pgrst, 'reload schema';
