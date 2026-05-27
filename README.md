# mobile-erp

Monorepo de las apps móviles del ERP. Sprint 4 (en curso).

## Arranque rápido

```bash
# Requiere Node 20+ y pnpm 10+
pnpm install

# Correr la primera app en modo dev (requiere Expo Go o dev client)
cd apps/recibos-cr
pnpm start
```

## Estructura

```
mobile-erp/
├── packages/
│   ├── shared-types/   Interfaces TypeScript compartidas (Productor, Recibo, sync DTOs)
│   ├── shared-api/     HTTP client + JWT/auth store (axios)
│   └── shared-sync/    WatermelonDB setup + sync adapter (pendiente Phase A2)
└── apps/
    └── recibos-cr/     App móvil "Recibos CR" (bundle: cr.confeldan.recibos)
```

## Apps planeadas

| App | Bundle | Estado |
|---|---|---|
| Recibos CR | `cr.confeldan.recibos` | en construcción |
| Productores-Fincas | TBD | post-POC |
| ERP Facturas | TBD | post-POC |
| CTRM Recibos | TBD | post-POC |

## Stack

- React Native + Expo (SDK 53+)
- TypeScript estricto
- WatermelonDB (offline-first SQLite)
- pnpm workspaces
- API REST contra `ERP.Backend` (mismo BE que la app web)

## Documentación

- Diseño completo: [`erp-frontend/docs/sprint-4-mobile-design.md`](../react/erp-frontend/docs/sprint-4-mobile-design.md)
- Contrato sync: [`ERP.Backend/Modules/Mobile/Docs/MobileSyncContract.md`](../flutter/sci2/ERP.Backend/ERP.Backend/Modules/Mobile/Docs/MobileSyncContract.md)
- Research impresión BT: [`erp-frontend/docs/escprint-research.md`](../react/erp-frontend/docs/escprint-research.md)
