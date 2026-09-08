# Dashboard gerencial de Looker Studio

## Fuentes

El informe utiliza exclusivamente estas vistas agregadas del esquema `analytics`:

- `operation_daily`: operación, cobertura, turnos, ausencias, horas extra y descargues.
- `finance_daily`: venta, costo, nómina y margen, incluida la nómina mensual cerrada.
- `contractor_snapshot`: distribución actual por estado, tipo y antigüedad contractual.

Ninguna fuente contiene nombres, documentos, teléfonos, correos o identificadores de contratistas.

## Seguridad

La migración crea el rol grupal `looker_studio_reader` sin capacidad de inicio de sesión. La credencial concreta de Looker Studio se crea directamente en producción y hereda únicamente este rol. No se debe guardar su contraseña en el repositorio ni en archivos `.env`.

Para rotar la credencial, cambia su contraseña en PostgreSQL y actualiza la fuente reutilizable en Looker Studio. Para revocarla inmediatamente, ejecuta `alter role <usuario> nologin;`. Para retirarla definitivamente, desconecta las sesiones activas y elimina el rol de inicio de sesión; el rol grupal y las vistas pueden permanecer.

## Uso del informe

- El rango predeterminado es el mes actual y cada indicador se compara con el período anterior de igual duración.
- Los controles de fecha, cliente, área y tipo de operación afectan los gráficos compatibles de cada página.
- Para forzar una consulta nueva, usa **Más opciones → Actualizar datos**.
- La fuente conserva resultados hasta 15 minutos antes de consultar nuevamente Supabase.
- El acceso del Director se revoca desde **Compartir → Administrar acceso**, eliminando `supcol2020@gmail.com`.

## Reconciliación

Los totales operativos deben coincidir con los RPC gerenciales existentes. En costos, los costos de turno sustituidos por nómina mensual se excluyen y se reemplazan por las asignaciones de períodos cerrados. La distribución diaria de nómina usa la misma convención 30/360 de la aplicación.
