---
name: add-backend
description: Procedimiento fijo para implementar un backend nuevo de Universal UI Engine (Web → UIA → SAP → …), para que cada uno se construya igual y termine pasando la misma suite de conformidad. Usar al empezar F2 (UIA), F4 (SAP), o cualquier backend futuro.
---

# add-backend — Universal UI Engine

Agregar un backend nuevo es la tarea que este proyecto repite varias veces (Web ya
hecho en F0; UIA en F2; SAP en F4). Codificar el procedimiento evita que cada uno se
implemente distinto — que es exactamente el riesgo que §2 del plan (la regla de oro)
identifica como el más caro de descubrir tarde. `packages/backend-web` es la
implementación de referencia: cuando algo de abajo diga "como en backend-web", léelo ahí.

## 0. Antes de escribir código

**La decisión de agregar este backend no se delega (§5.5).** Confirma con el humano que
es el momento (p. ej. F2 requiere `dotnet` instalado — verificar disponibilidad de
entorno ANTES, no como sorpresa a mitad de la implementación).

## 1. Estructura del paquete

```
packages/backend-<nombre>/
  package.json     # @uui/backend-<nombre>, depende de @uui/core (workspace:*)
  tsconfig.json     # extends ../../tsconfig.base.json, references: [{path: "../core"}]
  src/
    index.ts         # la clase que implementa Backend
    <lo que haga falta para hablar con la tecnología nativa>
  test/
    fixtureXxx.ts     # cómo llegar al fixture de referencia de ESTE backend
    conformance.test.ts
    golden.test.ts
    tokens.test.ts
```

Sigue el patrón de `packages/backend-web` para nombres de archivo — la previsibilidad
importa más que la elegancia local.

## 2. Implementar el contrato `Backend` (ADR-0002)

Cuatro métodos, ni uno más, ni uno menos:

```ts
interface Backend {
  query(region: BackendRegion): Promise<RawNode>;
  probeLocator(locator: Locator): Promise<boolean>;
  performAt(locator: Locator, verb: Verb, args?: ActionArgs): Promise<void>;
  dispose(): Promise<void>;
}
```

Puntos donde SIEMPRE hay que pensar, porque ya mordieron en F0:

- **`query()` nunca es "el árbol completo"** (D2). Respeta `region.root` (ya viene
  resuelto a un `Locator` — nunca un uid crudo), `maxDepth`, `filter`.
- **La raíz de una región nunca puede ser `decorative: true`** — invariante que hace
  cumplir `core::pruneDecorative` lanzando. Si tu tecnología nativa tiene un "nodo raíz"
  sin rol/nombre semántico propio (como `document.body` en Web), fuerza
  `decorative: false` explícitamente para el nodo en profundidad 0.
- **`decorative` se calcula excluyendo capacidades casi-universales** del check de "tiene
  interacción real" (en Web: `scrollIntoView`/`focus`). Si no las excluyes, NINGÚN nodo
  de tu backend calificará jamás como decorativo.
- **`supports: Verb[]` va POR NODO** (D6), nunca como una propiedad fija del backend.
  `core` nunca debe necesitar preguntar qué backend es esto para saber qué puede hacer.
- **`locators` va ordenado de más a menos robusto** y solo se ofrece un locator "role+name"
  si de verdad es único en el ámbito donde se resolverá — ofrecer uno ambiguo es peor que
  no ofrecerlo (miente sobre su confiabilidad).
- **`filter` debe devolver el subárbol COMPLETO del nodo que matchea**, sin volver a
  aplicar el filtro a sus propios descendientes — un bug real de F0 (ver ADR-0002, nota
  de D2) vació formularios enteros por aplicar el predicado recursivamente sin este corte.

## 3. Fixture de referencia

Cada backend trae su propio fixture versionado en `fixtures/` (como `fixtures/web-app`),
diseñado para EJERCITAR las decisiones del modelo, no solo para "verse bien":

- Un control real, invocable, con nombre reconocible (para `actionableButton`).
- Varias instancias del MISMO control con el MISMO nombre accesible (para
  `repeatedRows` — la prueba de que D1 no colisiona donde un hash sí lo haría).
- Andamiaje de maquetación sin rol/nombre semántico propio (para
  `decorativeWrapperWithChildren`).
- Un control que NO soporta algún verbo común, para probar el rechazo explícito de D6.

## 4. Suite de conformidad

`packages/core/conformance` YA existe — no se reescribe por backend. Se instancia:

```ts
defineConformanceSuite({ describe, it, beforeAll, afterAll, expect }, "backend-<nombre>", async () => ({
  createBackend: async () => /* tu Backend, apuntando al fixture */,
  scenarios: { actionableButton, repeatedRows, decorativeWrapperWithChildren, nodeWithoutSetValue },
}));
```

Si un caso de la suite no pasa, el defecto está en tu backend o en el fixture, no en la
suite — la suite es el contrato, no una sugerencia (§4 del plan: "no se agrega un backend
nuevo hasta que el modelo pase el test de contrato con los backends existentes").

## 5. Golden trees + presupuesto de tokens

- `golden.test.ts`: snapshot `compact` y `full` del fixture, comparados por FORMA
  NORMALIZADA (`normalizeShape` de `@uui/core`) vía `toMatchSnapshot()` — nunca por
  igualdad estricta (§6).
- `tokens.test.ts`: un snapshot ACOTADO (con `filter`/`maxDepth`) del fixture debe caber
  bajo 3.000 tokens. Un volcado SIN acotar puede excederlo legítimamente si el fixture es
  grande a propósito — mide igual, no lo ocultes, pero no lo conviertas en un `expect`
  que falle si la razón ya está documentada (ver el mismo patrón en
  `packages/backend-web/test/tokens.test.ts`).

## 6. Actualizar límites de dependencia

Si el backend nuevo necesita un sidecar o proceso externo (como el sidecar .NET de UIA),
verifica que `.dependency-cruiser.cjs` lo siga bloqueando fuera de `packages/core` — la
regla ya cubre CUALQUIER `packages/backend-*`, no hace falta tocarla por backend nuevo a
menos que cambie la convención de nombres.

## 7. ADR si hubo decisión arquitectónica

Si implementar este backend forzó a reinterpretar D1–D7 (como pasó con D5/origin al
implementar Web), documéntalo como una nota de implementación en el ADR correspondiente
— no como un ADR nuevo, a menos que sea una decisión genuinamente distinta, no una
consecuencia de una ya tomada.

## 8. Cierre

```bash
pnpm build && pnpm lint && pnpm deps && pnpm test
```

Todo en verde, más la skill `code-review` sobre el diff completo, antes de abrir el PR.
