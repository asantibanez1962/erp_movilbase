# Guía de operación, distribución y deploy

Documentación complementaria al README. Cubre los temas de "ya tengo el POC, ¿cómo lo llevo a clientes reales?".

## Pendientes POC

Decisiones aplazadas durante el POC, retomar en futuras iteraciones cuando aparezca el caso:

- **Logo en print del recibo** (~½ día) — agregar PNG corporativo al template HTML del recibo. Solución técnica: `expo-asset` + `expo-file-system` para cargar el PNG, convertir a base64 + embed como data URI en el `<img>` del template. Detalle paso-a-paso en §1.4 abajo.
- **Productor genérico** (~½ día) — UX para crear recibo cuando el productor no está en el cache. Necesita 2 columns extra en `re_Recibo` (nombre_libre + identidad_libre) + opción "+ Productor nuevo" en el picker.
- **Sequence reservation per (cosecha, agencia, device)** (~1-2 días) — elimina el numero_recibo manual. Tabla `mt.MobileSequenceReservation` + endpoints `/api/sync/sequence/{reserve,close}`. Phone reserva 300 #s al login + los consume secuencialmente.
- **Selector de empresa** (~½ día) — actualmente `companyId=8` hardcoded en `src/lib/config.ts`. Cuando se exponga multi-empresa al user, picker en login o drawer.
- **UX de rechazos editable** (~1 día) — actualmente los recibos rechazados quedan rojos con mensaje, sin acción. Sumar tap → editar (cambiar número) + Reintentar sync.
- **Phase D push notifications FCM** (~2-3 días) — server push al phone cuando cambian precios del día. Defer hasta primer caso real donde el cliente lo pide.
- **Otras apps** (Fincas, ERP-facturas, CTRM-recibos) — roadmap propio. Reusan los packages compartidos, cada una con sus screens en `apps/<nombre>/`.

---

## 1. Personalización del print de recibos

Todo el layout vive en una sola función: [`apps/recibos-cr/src/lib/print.ts`](../apps/recibos-cr/src/lib/print.ts) → `buildReciboHtml()`. Es HTML + CSS standard rendereado por el WebView del system + convertido a PDF por `expo-print`. Si sabés CSS, cualquier cambio es trivial.

### 1.1 Tamaño de papel

```css
@page { size: 80mm auto; margin: 4mm; }
```

- **Ancho fijo**: `80mm` es el ancho físico del rollo de la 3nstar PPT305BT. No tocar.
- **Alto variable** (`auto`): el papel crece hasta donde llegue el contenido + corte automático. Recomendado para recibos.
- **Alto fijo opcional**: `size: 80mm 200mm` corta a 200mm aunque sobre contenido. Sirve cuando el cliente quiere recibos de tamaño uniforme.
- **Márgenes**: `margin: 4mm` deja borde. Margen 0 imprime hasta el borde físico (no recomendado, algunas printers dejan banda blanca igual).

Para anchos distintos (impresoras de 58mm o 110mm), cambiá el primer valor y testeá.

### 1.2 Tipografía

```css
body { font-family: 'Courier New', Courier, monospace; font-size: 11pt; }
```

- **Monospace (recomendado)**: columnas alinean perfecto sin tener que jugar con espacios. Opciones: `Courier New`, `Consolas`, `Liberation Mono`, `monospace` (system default).
- **Sans-serif "moderno"**: `Arial`, `Helvetica`, `system-ui`. Mejor estética pero perdés alineación de columnas — necesitás CSS tipo `display: flex; justify-content: space-between` para alinear.
- **Tamaños comunes para 80mm**: 9pt-13pt. Default 11pt es buen punto medio. `<14pt` para texto enfatizado.
- **Bold selectivo**: usar `font-weight: bold` por clase (ya implementado en `.recibo-num` y `.total`).

**Custom fonts** (Roboto, fonts corporativas): requiere bajar `.ttf`, sumarlo a `assets/`, registrarlo con `expo-font`, usar `@font-face` en el CSS. Complejo y aporta poco — quedate con system fonts.

### 1.3 Contenido dinámico

Cualquier propiedad del recibo o del productor entra al template:

```ts
function buildReciboHtml(recibo, productorName, opts) {
  return `<!DOCTYPE html><html>...
    <div>Fecha: ${recibo.fecha}</div>
    <div>Hora: ${new Date().toLocaleTimeString('es-CR')}</div>
    <div>Productor: ${productorName}</div>
    <div>Cantidad: ${recibo.cantidad}</div>
    ...
  </html>`;
}
```

**Pattern de iteración rápida**: Metro hot-reloadea cualquier cambio en `print.ts` en ~3 seg. Guardás → en el phone tap "Imprimir" otra vez → ves resultado. Sin rebuild de APK.

**Para tirar layouts variables**: condicional dentro del template literal:

```ts
${recibo.observaciones ? `<div>Obs: ${escapeHtml(recibo.observaciones)}</div>` : ''}
${recibo.descuento_humedad > 0 ? `<div class="row"><span>Desc. humedad:</span><span>-₡ ${fmtMoney(recibo.descuento_humedad)}</span></div>` : ''}
```

### 1.4 Logo

`expo-print` no acepta paths relativos a archivos — solo URLs HTTPS o data URIs base64. Camino:

```ts
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system";

async function loadLogoBase64(): Promise<string | null> {
  try {
    const asset = Asset.fromModule(require("../../assets/logo.png"));
    await asset.downloadAsync();
    const b64 = await FileSystem.readAsStringAsync(asset.localUri!, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return `data:image/png;base64,${b64}`;
  } catch { return null; }
}

// En buildReciboHtml:
${logoDataUri ? `<img src="${logoDataUri}" style="width: 60mm; display: block; margin: 0 auto 6px;" />` : ''}
```

Requiere agregar `expo-asset` + `expo-file-system` (ambos sin plugin) y **nuevo dev client build** porque expo-file-system es native module.

Recomendación de archivos: PNG transparente o blanco, ~600×200px max para que se vea nítido a 60mm.

### 1.5 Layouts conocidos según volumen

| Tipo recibo | Long aprox | Notas |
|---|---|---|
| Mínimo (POC actual) | 8 cm | header + productor + cantidad/precio/total + firma |
| Completo | 12-15 cm | + descuentos + bonificaciones + observaciones |
| Documento legal | 18-25 cm | + datos legales empresa + clausulas + 2 copias separadas con cortes |

---

## 2. Distribución del APK

**Regla fundamental**: Metro NUNCA va en producción. Es bundler de dev — lento, no escalable, dependiente del file system. Producción = JS bundled adentro del APK.

### 2.1 Modelos de build (todos generan un APK production)

| Modelo | Comando | Requisitos | Cuándo |
|---|---|---|---|
| **EAS Build cloud** | `eas build --profile preview` | Cuenta expo.dev, internet | Default — primer build |
| **EAS Build local** | `eas build --profile preview --local` | JDK + Android SDK local | Sin internet, builds offline |
| **Prebuild + Gradle manual** | `npx expo prebuild` → `cd android && ./gradlew assembleRelease` | JDK + Android SDK | Cuando querés total control, no Expo cloud |

**EAS Build cloud (default)** — el más simple:
- Subís el código a expo.dev (encrypted, privado para tu account)
- Su CI buildea y firma el APK
- Te da link de descarga
- **Free tier: 30 builds/mes** (Production tier $19/mes para skipear cola + más builds)
- **Cuenta requerida**: sí, expo.dev (free)

**EAS Build local** — sin internet:
- Instalás JDK 17 + Android SDK + Android NDK
- `eas build --local` corre el build en tu PC con tu environment
- Te da APK en `./build-XXX.apk`
- No usa cloud de Expo en absoluto
- **Cuenta expo.dev**: NO requerida si solo hacés local builds + no usás EAS Update

**Prebuild + Gradle manual** — independiente total de Expo:
- `npx expo prebuild` genera carpeta `android/` standard
- Ya en `android/`, corrés `./gradlew assembleRelease` (standard Android dev)
- APK queda en `android/app/build/outputs/apk/release/`
- Si firmás manual: necesitás tu keystore (`keytool -genkey`)
- **Cero dependencia de Expo cloud/account**, pero más config inicial

Mi voto: arrancá con EAS Build cloud. Si crece (necesitás builds reproducibles en CI propio o el cliente exige no-cloud), migrá a EAS local o prebuild. El código es el MISMO — solo cambia el pipeline.

### 2.2 Updates después del primer install

**Opción A — APK reinstall manual** (POC actual)
- Cada cambio = nuevo APK + cada usuario reinstala
- Bien para 5-10 usuarios y 1-2 updates al mes
- Mal para bugfixes urgentes — fricción alta

**Opción B — EAS Update OTA (recomendado para producción)**
- APK queda instalado UNA vez
- Cada vez que abre, chequea endpoint de EAS Update por bundle nuevo
- Si hay, baja JS (~5MB típico) + aplica en próximo launch
- **Solo cambios JS/TS funcionan OTA** — cambios native deps (sumar lib nueva) siguen requiriendo APK nuevo
- Free tier: 1000 MAU; después ~$30/mes
- Comando: `eas update --channel production --message "fix: corregido cálculo descuentos"`
- Aplica en ~30 seg al canal, los users la bajan al próximo open

**Opción C — Self-hosted Updates**
- `expo-updates` con tu propio servidor que sirve los manifests
- Sin dependencia de EAS cloud, sin costo recurrente
- Requiere implementar el endpoint según el [protocolo Expo Updates](https://docs.expo.dev/technical-specs/expo-updates-1/)
- Vale la pena solo si tenés muchos clientes air-gapped o querés evitar la cuota mensual

Recomendación: arrancá con A (manual reinstall). Cuando llegues a 30+ usuarios y/o 3+ updates al mes, pasá a B.

---

## 3. Multi-tenant — N clientes con UI distinta

Escenario: Confeldan tiene Recibos diferentes que Coopechira. Mismo concepto, fields parcialmente distintos, logo distinto.

### 3.1 Tres caminos posibles

**Camino 1 — N APKs custom, 1 BE + 1 DB**
- Una DB con todos los recibos, `compania` columna decide a cuál pertenecen
- Una app per cliente en el monorepo: `apps/recibos-confeldan/`, `apps/recibos-coopechira/` reusan los packages compartidos
- Cada app declara sus fields visibles + su logo
- **Build**: `eas build --profile preview --app apps/recibos-confeldan` por cliente
- **Pro**: simple de armar; baja barrera técnica
- **Contra**: cada cliente requiere edit + rebuild

**Camino 2 — 1 APK metadata-driven**
- El APK lee al login un manifest que define: qué tabs/screens mostrar, qué fields renderear en el form, qué validations aplicar, qué logo usar
- Manifest persistido en `mt.CompanyMobileConfig` del BE
- 1 codebase para TODOS los clientes; cambios via UPDATE de manifest sin tocar app
- **Pro**: 1 APK distribuido a todos; cambios sin rebuild
- **Contra**: 2-4 semanas de infra para crear el "form engine" mobile (análogo al `DynamicFormView` del desktop); WMDB schema parcialmente dinámico es delicado

**Camino 3 — BE + DB + APK separados por cliente**
- Aislamiento total por cliente
- **Pro**: compliance / performance / billing per-tenant claro
- **Contra**: N deploys que mantener, sin economías de escala

### 3.2 Recomendación pragmática

- **Cliente 1 + 2**: Camino 1 (custom APKs). Hacelo, validá que ambos están contentos. Aprendés qué fields/screens varían y cuáles no.
- **Cliente 3+**: migrate a Camino 2 (metadata-driven). Ya tenés data real sobre qué necesita ser configurable.
- **Camino 3 SOLO** cuando un cliente exija aislamiento físico (banco, gobierno, requisito de compliance).

### 3.3 Logo + branding per cliente (independiente del camino)

Tabla nueva en el BE:
```sql
CREATE TABLE mt.CompanyMobileBranding (
    CompanyId       INT PRIMARY KEY,
    LogoBase64      NVARCHAR(MAX),   -- PNG en base64
    PrimaryColor    NVARCHAR(20),     -- "#0f172a"
    AppName         NVARCHAR(60),     -- "Recibos Confeldan"
    FOREIGN KEY (CompanyId) REFERENCES dbo.ge_companias(Id)
);
```

El mobile la pide al login (`GET /api/mobile/branding`) + cachea localmente. Cualquier camino (1/2/3) puede usar esto.

---

## 4. Estructura de UI / navegación (escalable)

El screen-state pattern actual (`useState<Screen>`) es OK para 3-5 screens. Cuando suman a 8-10 (Bitácora, Visitas, Fotos, Reportes, Settings, etc.) se vuelve insostenible.

### 4.1 Stack recomendado: React Navigation v7

3 navigators componibles:

- **Bottom Tabs** — para las 3-5 áreas operativas principales (siempre visibles abajo)
- **Drawer** (hamburguesa) — para items menos frecuentes (Settings, Acerca de, Logout, Sync)
- **Stack** — para drill-down dentro de cada tab (lista → detalle → editar)

### 4.2 Plantilla aplicada a tus 4 apps

**Recibos CR**:
```
Drawer (hamburguesa arriba izquierda):
  - Mis preferencias
  - Sincronizar todo
  - Acerca de
  - Cerrar sesión

Bottom Tabs:
  [👥 Productores] [📃 Bitácoras] [🧾 Recibos] [📊 Reportes]

Stack dentro de cada tab:
  Productores → ProductorDetail
  Bitácoras → BitacoraDetail → NuevoRecibo
  Recibos → ReciboDetail → Imprimir
```

**Fincas**:
```
Bottom Tabs:
  [👥 Productores] [🌱 Fincas] [📋 Visitas]

Stack:
  Productores → ProductorDetail → FincasDelProductor → FincaDetail
  Fincas → FincaDetail → [tabs internos: Certificados | Visitas | Fotos]
  Visitas → NuevaVisita → CapturarFotos
```

**ERP móvil**:
```
Bottom Tabs:
  [👥 Clientes] [📄 Facturas] [💰 Cobros] [📈 Estado cuenta]
```

**CTRM Recibos**: similar a Recibos CR con DIs en lugar de bitácoras.

### 4.3 Variación de UI según cliente (Camino 1 o 2 de §3)

Con React Navigation, los tabs/screens son condicionales:

```ts
<Tab.Navigator>
  {features.has('productores') && <Tab.Screen name="Productores" ... />}
  {features.has('bitacoras')   && <Tab.Screen name="Bitácoras" ... />}
  {features.has('recibos')     && <Tab.Screen name="Recibos" ... />}
  {features.has('reportes')    && <Tab.Screen name="Reportes" ... />}
</Tab.Navigator>
```

`features` viene del manifest del BE al login (parte de CompanyMobileBranding).

### 4.4 Costo de meter Navigation

- 3 packages nuevos: `@react-navigation/native`, `@react-navigation/native-stack`, `@react-navigation/bottom-tabs` (y/o `drawer`)
- Requiere `react-native-screens` (ya viene con expo) + `react-native-safe-area-context` (ya tenés)
- **Native modules** → un dev client build nuevo
- Refactoreo de las 4 screens actuales: ~1 día
- Aprendizaje: ~½ día para entender el modelo

Recomendación: meterlo ANTES de sumar más screens. Cada screen nueva con state-based agrega deuda exponencial.

---

## 5. Deploy en el server del cliente

**No requiere Node / npm / pnpm / Metro / VSCode**. Esos son dev-only.

### 5.1 Lo que va al server del cliente

```
[Server Windows o Linux]
├── ERP.Backend.dll (publicado con `dotnet publish -c Release`)
│   + appsettings.Production.json (connection strings + secrets)
│   + corre como Windows Service / IIS site / systemd unit
│
├── SQL Server (su instancia existente, normalmente ya está)
│   + DB con todos los scripts SQL del platform aplicados (Modules/*/Sql/*.sql)
│
└── (opcional) Frontend web (erp-frontend) buildeado como static
    + IIS sirviendo el folder dist/
    + O Nginx, lo que tengan
```

### 5.2 Pipeline manual de deploy nueva versión BE

1. En tu dev box: `dotnet publish ERP.Backend -c Release -o ./publish`
2. ZIP `publish/`
3. SCP/RDP al server del cliente
4. Detenés el service: `Stop-Service erp-backend` (o `iisreset /stop`)
5. Reemplazás los archivos
6. Iniciás: `Start-Service erp-backend`
7. Smoke test del endpoint salud

Para automatizar: GitHub Actions + Octopus Deploy + auto rollback. Para empezar, manual está bien.

### 5.3 Lo que NO va al server del cliente

- Node, npm, pnpm — solo dev tooling
- Metro bundler — solo dev
- Repo `mobile-erp` — vive en tu máquina + builds EAS
- VSCode / IDEs — solo dev
- EAS-cli — solo dev
- WatermelonDB — vive en el phone, no en el server

### 5.4 Mobile = cero infra del cliente

Los APKs se distribuyen por canal independiente del server:
- WhatsApp directo a usuarios
- Link de descarga interno (Sharepoint, Drive corp, página de la intranet)
- O EAS Update sirve los JS updates (cloud de Expo)

El **único punto de conexión** entre mobile y server cliente es el endpoint HTTPS del BE. El phone golpea `https://erp.cliente.com/api/sync/...` y eso es todo.

---

## 6. Quick reference de comandos

### Dev day-to-day

```powershell
# Arrancar BE (en repo erp-backend)
dotnet run

# Arrancar Metro (en monorepo mobile)
cd e:\soft\mobile-erp\apps\recibos-cr
$env:EXPO_PUBLIC_API_URL = "http://192.168.100.10:5249"
pnpm start --dev-client

# Type check
npx tsc -p tsconfig.json --noEmit

# Expo doctor
npx expo-doctor
```

### Build dev client (cuando agregás native module)

```powershell
cd e:\soft\mobile-erp\apps\recibos-cr
npx eas-cli build --platform android --profile development --non-interactive --no-wait
```

### Build production (APK para distribuir)

```powershell
# Cloud build (default)
npx eas-cli build --platform android --profile preview --non-interactive --no-wait

# Local build (sin internet, requiere JDK+SDK)
npx eas-cli build --platform android --profile preview --local

# Manual (sin Expo cloud)
npx expo prebuild --platform android
cd android
./gradlew assembleRelease
# APK en: android/app/build/outputs/apk/release/
```

### OTA update (solo JS, requiere EAS Update)

```powershell
npx eas-cli update --channel production --message "fix: corregido X"
```

### Add native module + rebuild

```powershell
pnpm add expo-camera         # ejemplo
npx expo install --check     # checkea versiones
npx eas-cli build --platform android --profile development --non-interactive --no-wait
```
