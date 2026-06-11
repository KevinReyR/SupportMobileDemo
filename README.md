# Support Colombia Mobile

Aplicación Expo para la operación de personal temporal de Support Colombia, conectada a Supabase.

## Configuración

```bash
npm install
copy .env.example .env
npm start
```

Configure en `.env` la URL del proyecto y su clave publicable. El archivo `.env` está excluido de Git.

## Alcance V1

- Autenticación con correo y contraseña, sesión persistente y recuperación por correo.
- Navegación por rol: Administrador, Director, Coordinador y Cliente.
- Operaciones, registro inicial/final, revisión y aprobación.
- Solicitudes de personal.
- Personal, perfil e historial del contratista.
- Estadísticas calculadas desde los datos operativos.
- Administración básica de usuarios existentes.
- RLS por usuario activo, rol y clientes asignados.

## Base de datos

Las migraciones se encuentran en `supabase/migrations`:

- `202606110001_support_colombia_v1.sql`: esquema mínimo, RLS, RPC y semilla.
- `202606110002_fix_demo_text.sql`: normalización de textos de demostración.
- `202606110003_harden_functions_and_text.sql`: permisos de funciones y normalización ASCII-safe.

## Cuentas demo

- `coordinador.demo@supportcolombia.com`
- `cliente.demo@supportcolombia.com`
- `director.demo@supportcolombia.com`
- `admin.demo@supportcolombia.com`

La contraseña temporal se entrega fuera del repositorio.

## Verificación

```bash
npm run typecheck
npm run export:web
npx expo install --check
```

## Expo Go en iOS físico

Permita el acceso de Expo Go a **Red local** en Ajustes de iOS. Si el dispositivo
está conectado al mismo router que el equipo, use primero:

```bash
npm run start:ios-device
```

El arranque de la aplicación tiene límites de tiempo para restaurar la sesión y
cargar Supabase, por lo que un fallo de red debe mostrar el login o un mensaje de
reintento en lugar de dejar la aplicación bloqueada.

El túnel queda como alternativa con `npm run start:tunnel`, pero depende del
servicio externo de ngrok y puede fallar aunque Metro y la aplicación estén bien.
Antes de iniciar cualquiera de los dos modos, cierre cualquier Metro anterior que
esté ocupando el puerto `8081`.
