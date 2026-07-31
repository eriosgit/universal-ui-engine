# CONTEXT.md — Universal UI Engine

Lenguaje de dominio, invariantes y "cómo se hacen las cosas aquí". Este documento y
`docs/adr/` son lo que hace que un agente (o una persona nueva) no reinvente decisiones
cada sesión — ver Plan_Desarrollo_Universal_UI_v2.md §5.1.

## Glosario

- **Nodo (`UINode`)**: la unidad del Modelo Universal de UI. Representa un control (botón,
  campo, fila…) con un `role` canónico, un `nativeRole` propio del backend, un `uid` opaco
  de sesión, y sus hijos. Ver `packages/core/src/types.ts` y ADR-0001.
- **Locator**: una forma concreta de volver a encontrar un elemento en el backend nativo
  (testId, css, xpath, role+name, coords…), con una `confidence` estimada. Nunca se expone
  al consumidor — vive solo dentro del fingerprint.
- **Fingerprint**: el conjunto de locators + ruta estructural que hay *detrás* de un `uid`.
  Es lo que el resolver re-intenta, en orden de degradación, cada vez que se actúa sobre
  ese `uid`. Ver ADR-0001 (D1).
- **`uid`**: etiqueta opaca de sesión. NO es un handle vivo del backend — se re-resuelve
  contra el fingerprint en cada `act()`. No sobrevive a otra sesión.
- **Snapshot**: la proyección serializada de un nodo y su subárbol, en modo `compact` o
  `full`, con su `tokenEstimate`. Lo que ve el consumidor (agente vía MCP/CLI).
- **Backend**: la implementación concreta que sabe hablar con una tecnología de UI (Web
  vía Playwright, UIA vía sidecar .NET en F2, SAP GUI Scripting en F4…). Implementa la
  interfaz `Backend` de `packages/core/src/backend.ts`. Nunca es importado por `core`.
- **Región (`Region`/`BackendRegion`)**: lo que se le pide a un backend en un `query()` —
  un `root` (uid, resuelto a Locator antes de llegar al backend), `maxDepth` y `filter`.
  Nunca "el árbol completo" — ver ADR-0001 (D2).
- **Verbo (`Verb`)**: una primitiva de acción cerrada (`invoke`, `setValue`, `toggle`,
  `expand`, `select`, `focus`, `scrollIntoView`). La declara el NODO en `supports`, no el
  backend — ver ADR-0002 (D6).
- **Decorativo (`decorative`)**: un nodo que el backend juzga andamiaje de maquetación
  (sin rol semántico, sin nombre accesible, sin interacción real). Se poda y reparenta al
  serializar en modo `compact` — nunca en el backend. Ver ADR-0001 (D4).
- **Flujo**: una secuencia grabada de snapshots + acciones (F3, todavía no implementado).
- **Golden tree**: una captura versionada de la *forma normalizada* (role + name +
  jerarquía) de un snapshot de referencia, usada para detectar regresiones sin que la
  suite se ponga roja por cambios de SO/resolución/tema (§6 del plan).

## Invariantes que no se negocian

1. **`packages/core` no importa ningún `packages/backend-*` ni `playwright`.** Aplicado
   por `pnpm deps` (dependency-cruiser) en CI — ver ADR-0002.
2. **`core` nunca ramifica por identidad de backend** (`if (backend === 'uia')` o
   equivalente). Pregunta capacidades (`node.supports`), nunca identidad. Aplicado por
   ESLint (`no-restricted-syntax`) además de por diseño de tipos (D6).
3. **Un `uid` nunca es un handle vivo.** Siempre se re-resuelve vía `resolveFingerprint`
   antes de actuar (D1).
4. **`raw` y `locators` nunca llegan a un consumidor externo**, en ningún modo de
   serialización — son plomería interna (ver `serialize.ts::stripInternalFields`).
5. **La poda de nodos decorativos ocurre SOLO al serializar**, nunca en el backend, y
   siempre reparentando (nunca se destruye contenido real) — D4.
6. **Los golden trees se comparan por forma normalizada**, nunca por igualdad estricta —
   §6 del plan.

## Dónde está cada cosa

```
packages/core/            motor — sin dependencias de backend
  src/types.ts             el Modelo Universal de UI (ADR-0001)
  src/backend.ts           el contrato Backend (ADR-0002)
  src/session.ts           registro uid↔fingerprint, orquesta snapshot/find/act
  src/resolver.ts           degradación de locators (D1/F1)
  src/actions.ts            composición de verbos vía node.supports (D6)
  src/find.ts               predicados deterministas + explicación (D7)
  src/serialize.ts          poda/reparenting + proyección compact/full + tokens
  conformance/              suite de conformidad — cualquier Backend debe pasarla

packages/backend-web/     backend Web (Playwright)
  src/pageScript.ts         TODO el código que corre dentro del navegador (page.evaluate)
  src/index.ts              WebBackend: traduce Backend↔pageScript

packages/adapter-cli/      CLI `uui` — bucle de depuración del agente (§5.2: sin MCP de navegador)
packages/adapter-mcp/      servidor MCP (stdio): ui.snapshot, ui.find, ui.act

fixtures/web-app/          app de referencia estática (login, 20 filas, sección en vivo)
docs/adr/                  decisiones arquitectónicas congeladas
docs/specs/                una spec por unidad de trabajo
```

## Convenciones de código

- TypeScript estricto (`strict`, `noUncheckedIndexedAccess`) en todo el monorepo.
- `pageScript.ts` es especial: TODO su contenido corre en un contexto de navegador
  aislado vía `page.evaluate(fn, args)`. Playwright serializa `fn` con `.toString()` —
  **cualquier función o constante que ese código necesite debe estar declarada DENTRO**
  de la función exportada, nunca a nivel de módulo (un closure de módulo es invisible en
  el navegador). Ver el comentario de cabecera de ese archivo.
- Un backend nuevo (`add-backend`, §5.2) implementa `packages/core/src/backend.ts` y debe
  pasar `packages/core/conformance/` contra su propio fixture de referencia.
