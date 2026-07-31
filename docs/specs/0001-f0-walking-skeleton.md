# Spec 0001 — F0: esqueleto caminante

- **Estado:** Implementado
- **Referencias:** ADR-0001 (modelo universal), ADR-0002 (contrato core↔Backend)
- **Fase del plan:** Parte C de `el-plan-de-desarrollo-distributed-swing.md` (cimientos +
  F0 del `Plan_Desarrollo_Universal_UI_v2.md`)

## Objetivo

Falsar (o no) la primera mitad de la hipótesis central del proyecto: que el Modelo
Universal de UI puede sostener un backend real de punta a punta — motor, backend Web,
localización, ejecución de acciones, y los tres adaptadores de consumo (CLI, MCP) — sin
una sola rama `if (backend === 'x')` en el núcleo. La otra mitad (¿aguanta un SEGUNDO
backend con forma muy distinta?) es F2 y queda fuera de este alcance a propósito (§4 del
plan: "no se agrega un backend nuevo hasta que el modelo pase el test de contrato con los
backends existentes" — con uno solo, F0 demuestra coherencia, no abstracción).

## Alcance

1. `packages/core`: tipos (ADR-0001), contrato `Backend` (ADR-0002), resolver con
   degradación de locators, motor de `find` determinista, motor de acciones vía
   `supports`, serializador compact/full con poda+reparenting y presupuesto de tokens,
   `Session` (registro `uid↔fingerprint`).
2. `packages/core/conformance`: suite parametrizada, escrita ANTES del segundo backend
   (F0, no F2) para que de verdad describa el contrato y no lo que un backend concreto
   hace.
3. `packages/backend-web`: implementación sobre Playwright. Todo el cálculo de
   rol/nombre/decorativo/verbos/locators corre en un único `page.evaluate` por región
   (`pageScript.ts`) — simplificación deliberada de F0: computación propia de rol/nombre
   accesible, no el motor de accesibilidad real del navegador (ver ADR-0001, nota D4).
4. `fixtures/web-app`: app estática de referencia (login, 20 filas idénticas, sección
   regenerable, andamiaje decorativo) — diseñada para atacar D1/D4 directamente.
5. `packages/adapter-cli` y `packages/adapter-mcp`: los dos adaptadores de consumo de F0.
6. Demo de salida (C7): un agente inicia sesión en `fixtures/web-app` usando solo
   `ui.snapshot`/`ui.find`/`ui.act`, sin un selector escrito a mano.

## Criterios de aceptación

- [x] `pnpm build` (project references) compila los 4 paquetes sin errores.
- [x] `pnpm lint` limpio, incluida la regla que atrapa `node.backend === '...'`.
- [x] `pnpm deps` (dependency-cruiser): cero violaciones — `core` no importa `backend-*`
      ni `playwright`.
- [x] `pnpm test`: suite de conformidad en verde contra `backend-web`, más pruebas
      unitarias de `core` (resolver/serialize/find/actions/session).
- [x] Golden trees (`packages/backend-web/test/golden.test.ts`) comparados por forma
      normalizada (§6), no por igualdad estricta.
- [x] Presupuesto de tokens medido (§3) — ver nota de alcance abajo.
- [ ] Demo grabada del login end-to-end vía MCP (C7 — pendiente de ejecutar y grabar).

### Nota de alcance: presupuesto de tokens (§3)

Al medir contra `fixtures/web-app`, el volcado **sin acotar** de las 20 filas (puestas a
propósito para D1) excede el objetivo de 3.000 tokens (~4.600 medido). Se decidió, y se
documenta en `packages/backend-web/test/tokens.test.ts`, que el objetivo de 3.000 aplica a
un snapshot **acotado** (`filter`/`maxDepth`/`root` — las escapatorias que el propio §3
exige que existan), no a cualquier volcado sin acotar de cualquier pantalla: el propio §3
usa como ejemplo una pantalla SAP de 4.000 nodos que TAMPOCO cabría sin acotar — esa es la
razón de ser de las escapatorias, no una falla de ellas. Un snapshot acotado por rol (p.
ej. solo el formulario de login) sí se midió por debajo de 3.000. El volcado sin acotar se
mide igual (métrica obligatoria) y queda registrado, no oculto.

## Fuera de alcance (explícito)

- Backend UIA (F2) — bloqueado además por entorno: falta instalar .NET 8 SDK.
- Degradación de locators a coordenadas cuando un verbo no está soportado (F1).
- Ranking semántico sobre `find` (F1).
- Observador de cambios / esperas basadas en estabilidad del árbol (F1).
- Grabador de flujos y generación de código (F3).
