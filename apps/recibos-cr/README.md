# Recibos CR

Primera app móvil del Sprint 4. Bundle Android: `cr.confeldan.recibos`.

## Estado actual (Phase A POC)

- ✅ Login contra `/api/auth/login` con `X-Client-Kind: mobile` (refresh 30d)
- ✅ Auto-rehidratación de sesión al boot (lee refresh token de SecureStore)
- ✅ Lista de productores via `POST /api/sync/productores/pull`
- ✅ Pull-to-refresh + manejo de errores
- ⏸ WatermelonDB offline (Phase A2)
- ⏸ Crear recibos (Phase B)
- ⏸ Print BT (Phase C)
- ⏸ Push notifications (Phase D)

## Pre-requisitos

- Node 20+, pnpm 10+ (instalado en el root del monorepo)
- BE corriendo en `http://localhost:5249` con SQL del Sprint 4 ejecutado
- Android Studio + AVD configurado, **o** Android device físico con
  Expo Go (modo dev rápido, hasta antes de meter native modules)

## Cómo correr

### Desde el root del monorepo

```bash
pnpm install   # solo la primera vez (o cuando cambian deps)
```

### Lanzar el dev server

```bash
cd apps/recibos-cr
pnpm start
```

Esto abre el Metro bundler. Después:
- Apretar `a` → abre en Android emulator
- Escanear el QR con Expo Go → abre en device físico

### Configurar la URL del backend

Por default apunta a `http://10.0.2.2:5249` (loopback al host desde
el AVD de Android Studio). Para device físico necesitás tu LAN IP:

```bash
# Windows: ipconfig | findstr IPv4
# Linux/Mac: ifconfig | grep "inet "

# Luego al lanzar:
EXPO_PUBLIC_API_URL=http://192.168.1.50:5249 pnpm start
```

O editá `app.json` → `expo.extra.apiBaseUrl`.

### Probar el flow

1. Login con credenciales del ERP (admin u otro user con permiso `ge.productor.list`)
2. App muestra los productores de **compania=8** (hardcoded en `src/lib/config.ts`
   para el POC — cuando metamos selector de empresa lo movemos a state)
3. Pull-to-refresh tira un nuevo pull al BE
4. "Salir" hace logout (borra tokens de SecureStore)
5. Re-abrir el app debería traerte de vuelta a Productores sin pedir login
   (refresh token vivo por 30 días)

## Generar APK instalable (eventualmente)

Por ahora `expo start` corre via Metro (modo dev — necesita conexión al
dev server). Para distribuir APK standalone:

```bash
# requiere cuenta Expo (npm install -g eas-cli + eas login)
eas build --platform android --profile preview
```

EAS Build corre en la nube de Expo (free tier: 30 builds/mes). Genera un
APK firmado y te da un link para bajarlo. Distribución por WhatsApp como
planeado.

Antes del primer build:
1. `eas init` (genera projectId)
2. `eas credentials` (Expo gestiona el keystore por nosotros, o le pasamos
   el nuestro generado con `keytool`)

## Estructura

```
src/
├── lib/
│   ├── api.ts          ← bootstrap del apiClient + sync client
│   ├── config.ts       ← API base URL, company id, app id
│   └── deviceId.ts     ← UUID estable por install (SecureStore)
└── screens/
    ├── LoginScreen.tsx
    └── ProductoresScreen.tsx

App.tsx                 ← router primitivo: login → productores
index.ts                ← Expo entry point
```

## Conocido

- Layout asume portrait (Android phone). Tablet/landscape no probado.
- `companyId=8` hardcoded; selector vendrá al meter Phase B.
- Sin WMDB todavía → cerrar el app pierde los productores cargados.
  Phase A2 los persiste a SQLite local.
- Sin tests todavía. Se suman cuando estabilice el flow base.
