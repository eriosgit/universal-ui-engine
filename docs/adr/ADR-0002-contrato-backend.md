# ADR-0002: Contrato core↔Backend

- **Estado:** Aceptado
- **Fecha:** cierre de la sesión de grilling previa a F0
- **Decide:** humano (§5.5 del plan — el contrato entre `core` y `Backend` no se delega)

## Contexto

Además del modelo de datos (ADR-0001), la sesión de grilling cerró dos decisiones sobre
la SUPERFICIE del contrato entre `packages/core` y cualquier `Backend`: cómo se pide una
región (perezosidad, D2) y cómo se ejecuta una acción (verbos, D6). Ambas son las que
hacen — o no — estructuralmente imposible el error que §5.2 del plan llama "el único que
puede matar el proyecto": un `if (backend === 'x')` dentro de `core`.

## Decisiones

### D2 — La perezosidad es propiedad del contrato, no del núcleo

`core` **nunca** tiene "el árbol completo" como concepto. `Backend.query(region)` siempre
recibe una región acotada — `root` (un `Locator` ya resuelto, ver más abajo), `maxDepth`,
`filter` — y el backend decide CÓMO satisfacerla: Web con un único `page.evaluate`,
UIA (F2) con un `CacheRequest` de FlaUI en un solo cruce de proceso COM.

**Por qué no un `getTree()`:** la asimetría de costo entre backends (un volcado web es
casi gratis; una propiedad UIA es una llamada COM entre procesos) no debe filtrarse fuera
de `query()` — es exactamente lo que prohíbe la regla de oro §2 del plan.

**Detalle de arquitectura que no estaba explícito en la sesión de grilling y se descubrió
implementando `Session.snapshot`/`find` (C1):** el `root` de una `Region` PÚBLICA (la que
ve el consumidor vía `SnapshotOptions`) es un `uid` de sesión — algo que el backend NUNCA
ha visto y no puede interpretar, porque el registro `uid → fingerprint` vive únicamente en
`Session` (núcleo). Por eso el contrato real de `Backend.query` usa un tipo distinto,
`BackendRegion`, cuyo `root` es un `Locator` ya resuelto:

```ts
// Region (pública, en SnapshotOptions): root?: string (uid)
// BackendRegion (lo que de verdad recibe el backend): root?: Locator
```

`Session` resuelve el `uid` a un `Locator` vivo (vía `resolveFingerprint`, D1) ANTES de
llamar a `backend.query()`. El backend nunca necesita saber qué es un "uid de sesión".

**Filtro (`region.filter`) — semántica exacta, corregida durante la implementación:**
un nodo que matchea el filtro se devuelve COMPLETO con todo su subárbol (el filtro no se
re-aplica a sus descendientes); un nodo que no matchea desaparece y sus descendientes que
sí matcheen se reparentan hacia arriba. La raíz de la región se conserva siempre,
matchee o no. La primera implementación aplicaba el mismo predicado recursivamente
incluso por debajo de un nodo ya coincidente, así que filtrar por `role:'form'` vaciaba
el propio formulario (sus `input`/`button` no tienen ellos mismos `role:'form'`) — se
detectó con una prueba de regresión en `packages/backend-web/test/conformance.test.ts`.

### D6 — Verbos primitivos por pattern, declarados POR NODO

El backend expone un conjunto **cerrado y pequeño** de primitivas —`invoke`, `setValue`,
`toggle`, `expand`, `select`, `focus`, `scrollIntoView`— alineadas a los ControlPattern de
UIA. Cada **nodo** (no el backend) declara en `supports: Verb[]` cuáles admite, igual que
UIA declara patterns por elemento.

`core` (`actions.ts::performVerb`) compone acciones consultando `node.supports` —
**nunca** pregunta identidad de backend. Esto es lo que hace estructuralmente imposible
el `if (backend === 'uia')`: no hay ninguna pregunta de identidad que hacer.

**F0 no degrada a coordenadas** cuando un verbo no está soportado — falla explícito
(`UnsupportedVerbError`). Esa degradación es del resorte de F1 ("reintento con
degradación"); construirla en F0 habría adelantado trabajo de otra fase sin sus propias
pruebas.

**Aplicado por herramienta, no solo por convención:**
- `dependency-cruiser` (`.dependency-cruiser.cjs`) bloquea que `packages/core` importe
  cualquier `packages/backend-*` o `playwright`.
- ESLint (`no-restricted-syntax` en `eslint.config.js`) bloquea comparaciones
  `node.backend === '...'` como capa adicional (atrapa el patrón aunque no pase por un
  import prohibido).
- La skill `code-review` del proyecto (`.claude/skills/code-review/`) lo revisa además a
  nivel de intención de diseño, no solo de sintaxis.

## Consecuencia práctica

Un backend nuevo (F2: UIA, F4: SAP) implementa exactamente:

```ts
interface Backend {
  query(region: BackendRegion): Promise<RawNode>;
  probeLocator(locator: Locator): Promise<boolean>;
  performAt(locator: Locator, verb: Verb, args?: ActionArgs): Promise<void>;
  dispose(): Promise<void>;
}
```

y debe pasar `packages/core/conformance/` contra su propio fixture de referencia antes de
considerarse conforme (ver `docs/specs/` y la skill `add-backend`).
