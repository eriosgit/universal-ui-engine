# ADR-0006 — Catálogo de selectores: exponer lo que D1 oculta

**Estado:** aceptado
**Fecha:** 2026-07-31
**Afecta:** `packages/core/src/types.ts` (Modelo Universal), `packages/core/src/session.ts`,
`packages/backend-web/src/pageScript.ts`, adaptadores CLI y MCP

## Contexto

El objetivo declarado del producto es: **escanear una pantalla y devolverle al
desarrollador los selectores**, ordenados, para que los use en SU proyecto — web hoy,
escritorio después. Un login escaneado debe salir con cada campo, su `id`, su `name`, su
tipo, si es obligatorio y con qué selector alcanzarlo.

El núcleo hace hoy exactamente lo contrario, y a propósito. `session.ts:124`:

> `find()` nunca expone `raw` ni `locators` — sería tan violación de la opacidad de D1
> aquí como en un snapshot.

D1 (ADR-0001) decidió que el `uid` es opaco y que el selector se re-resuelve en cada
`act()`, nunca se entrega. La razón sigue siendo buena **para actuar**: un handle o un
selector guardado se pudre entre renders, y entregarlo invita a que alguien lo almacene y
actúe con él más tarde, que es la clase de bug que D1 existe para hacer imposible.

Pero D1 se está aplicando a algo que no es actuar. **Reportar no es actuar.** Un catálogo
es un artefacto de lectura, con fecha, para que un humano o un generador lo consuman una
vez — no un handle vivo.

Falta además información. El modelo captura rol, nombre, valor, estados, bounds, verbos y
locators, pero tira `id`, `name`, `type`, `required`, las opciones de un `select` y el
`placeholder`: `pageScript.ts` los lee (líneas 98 y 178) solo para deducir el rol y el
label, y los descarta.

## Decisión

**1. Superficie explícita de exportación, separada de la de acción.**

`snapshot()` y `find()` siguen exactamente igual de opacos: D1 intacto. Se añade una
operación distinta, `catalog()`, que sí devuelve `locators`. La separación es el punto:
quien quiera actuar sigue pasando por `uid`; quien quiera un selector pide un catálogo y
recibe un documento fechado que dice de dónde salió.

**2. Se amplía el Modelo Universal, con análogo de escritorio en cada campo.**

Nada de esto es web-only, y por eso entra al modelo y no a `raw`:

| Campo nuevo | Web | UIA (escritorio) |
|---|---|---|
| `automationId: string \| null` | atributo `id` | `AutomationId` |
| `description: string \| null` | `placeholder` / `aria-describedby` | `HelpText` |
| `options: string[] \| null` | `<option>` de un `select` | `SelectionPattern` |
| estado `required` | `required` / `aria-required` | `IsRequiredForForm` |
| locator `attrName` | atributo `name` | — (backends sin equivalente no lo emiten) |

`required` entra como `State` porque es exactamente eso: un estado del control, igual que
`readonly`, que ya existe. `attrName` entra como `LocatorKind` porque el atributo `name`
**es** una forma de localizar (`[name=email]`), no un dato suelto; los backends que no
tengan equivalente simplemente no lo emiten, como ya pasa con `sapId`.

**3. El catálogo recomienda un selector, y muestra los respaldos.**

Se ordena por la confianza que ya existe en el modelo: `testId` 0.95 → `automationId`
0.9 → `attrName` 0.85 → `role+name` 0.8 → `css` 0.6 → `xpath` 0.55. `coords` (0.05) **nunca**
entra al catálogo: un selector por coordenadas no le sirve a nadie pegado en un proyecto.

**4. Dos formatos, una fuente.** JSON para consumir por máquina y Markdown para leer y
pegar en un PR, generados del mismo objeto. El Markdown es el que hace útil la
herramienta a un humano; el JSON, el que la hace útil a un agente.

## Consecuencias

- **D1 no se revierte, se acota.** Queda dicho que su opacidad protege el camino de
  ACCIÓN. Si alguien quiere actuar con un selector del catálogo, el modelo no se lo
  impide — pero ya no puede decir que no le avisamos: el catálogo lleva fecha y URL.
- El presupuesto de tokens de ADR-0003 **no aplica** al catálogo. Son consumidores
  distintos: el snapshot alimenta a un modelo con presupuesto; el catálogo alimenta a un
  desarrollador que quiere todo. Medir el catálogo contra los 3000 tokens sería aplicar
  el criterio equivocado, y el gate de tokens debe seguir midiendo solo snapshots.
- La suite de conformidad crece: `automationId`, `description`, `options` y `required`
  pasan a ser parte del contrato que todo backend nuevo debe satisfacer, o declarar
  explícitamente que no puede.
- Los golden trees **no** cambian: `normalizeShape` compara roles, nombres y jerarquía, y
  ninguno de los campos nuevos entra ahí. Se esperaba tener que refrescarlos y no hizo
  falta — verificado, no asumido.

- **Corrección.** Este ADR afirmó primero que "el presupuesto de tokens tampoco se movió",
  y era FALSO. Una revisión adversarial lo midió: serializar los tres campos en cada nodo
  costaba **+27,0 % en `actionable`** (1937 vs 1525) y **+28,9 % en `compact`** (4869 vs
  3778) sobre `fixtures/web-app`, con `description` y `options` a `null` en el **100 %** de
  los nodos. El gate de §3 no lo detectó porque solo mide un snapshot filtrado por `form`.

  La afirmación se apoyaba en que la suite seguía verde, que no es lo mismo que medir. El
  fallo de método importa más que el número: se dijo "verificado, no asumido" sobre algo
  asumido. Corregido en `stripInternalFields` — los tres campos se omiten cuando son
  `null`, igual que `value`; el consumidor que los necesita es el catálogo, que no pasa
  por el serializador. Medido después: **1585** en `actionable` y **3852** en `compact`.
  El residuo sobre la línea base (+3,9 % y +2,0 %) son los `automationId` que sí existen,
  y esos se pagan a gusto: son información real, no `null` repetidos.

- **El escaneo espera a que la pantalla se asiente, y no es opcional por defecto.**
  Descubierto probando contra una app real, no en el diseño: tres escaneos seguidos de la
  MISMA URL dieron 960, 207 y 207 nodos según cuándo cayera la captura sobre una SPA que
  renderiza por etapas. Un snapshot corto se nota; **un catálogo corto no** — tiene el
  mismo aspecto que uno completo, solo que le faltan campos, y el desarrollador se lleva
  una lista incompleta creyendo que es la pantalla entera. Por eso `Session.catalog()`
  reutiliza la espera de [ADR-0005](ADR-0005-espera-por-estabilidad-del-arbol.md) por
  defecto (500 ms de silencio, 15 s de plazo), y `--no-wait` existe solo para páginas
  estáticas donde estorba. Con la espera, tres escaneos seguidos dan 905, 905 y 905.

  Esto obligó a sacar la espera de `flow.ts` a `stability.ts`: tiene dos consumidores con
  motivos distintos (no actuar sobre una pantalla a medias; no *reportar* una pantalla a
  medias) y dejarla escondida en el ejecutor de flujos habría llevado a duplicarla.

- Si se agota el plazo, se captura igual en vez de fallar: una app con una animación
  perpetua nunca se aquieta, y ahí un catálogo del último estado vale más que un error.
