# ADR-0005 — Espera por estabilidad del árbol (`waitForStable`)

**Estado:** aceptado
**Fecha:** 2026-07-31
**Afecta:** `packages/core/src/flow.ts` (contrato `FlowStep`), `packages/codegen`

## Contexto

Un flujo generado contra una app real (Alegra, crear ítem de venta) fallaba siempre en
`El campo siguió vacío: Unidad de medida`, mientras que `uui run` del MISMO flujo pasaba
el 100% de las veces. El diagnóstico descartó, con evidencia medida, las hipótesis
razonables:

- **No era la localización.** El XPath de respaldo devuelve un único elemento y es el
  correcto (el input con `placeholder="Buscar..."` *es* el combobox de Unidad de medida).
- **No era que el clic no llegara.** Tras el clic el botón queda `class="type-segment active"`.

La causa real es un render en DOS ETAPAS: al abrir el formulario hay 13 inputs a los
~211 ms y 16 a los ~1135 ms. El flujo esperaba a que el campo "Nombre" fuera visible —
condición que se cumple en la etapa 1 — y hacía clic en "Servicio" dentro de la ventana
inestable. El clic se aplica visualmente, pero el autocompletado derivado de "Unidad de
medida" nunca dispara. Con una espera previa, el campo se llena en 46 ms.

El dato incómodo: **`uui run` pasaba por suerte.** Sus round-trips por paso le regalan a
la SPA el ~1 s que necesita. El código generado no tiene esa latencia, así que es *más
rápido que el motor* y destapa carreras que el motor tapaba. Cualquier flujo descubierto
con `uui run` puede llevar esta bomba dentro sin que nadie lo note hasta generar el código.

Y no hay atajo con los predicados actuales: los tres inputs que aparecen en la segunda
etapa **no tienen nombre accesible**, así que no se puede expresar "espera a que aparezca
X". No hay un X que nombrar.

## Decisión

Se añade una acción al DSL de flujos:

```ts
| { action: "waitForStable"; quietMs?: number; timeoutMs?: number; label?: string }
```

Espera a que el árbol de UI deje de cambiar durante `quietMs` milisegundos seguidos
(por defecto 500), con un plazo máximo `timeoutMs`. La implementación vive en `core`:
toma snapshots periódicos, compara su **forma normalizada** (`normalizeShape` — roles,
nombres y jerarquía, igual que los golden trees) y considera el árbol quieto cuando la
forma se repite durante toda la ventana.

Se descartaron dos alternativas:

- **Que `act` esperara estabilidad siempre**, sin cambiar el DSL. Arreglaría este flujo y
  los futuros sin tocar ningún `.flow.json`, pero añade latencia a cada paso y hace el
  comportamiento implícito: un flujo dejaría de decir por qué espera. La espera explícita
  se revisa en un PR; la implícita se sufre en producción.
- **Un `Backend.waitForStable?` nuevo.** Sería un cambio al contrato `Backend` para algo
  que se puede componer con `query()`, que todos los backends ya implementan. `core`
  pregunta por capacidades que ya existen en vez de exigir una nueva (D6).

## Consecuencias

- El paso es **agnóstico de backend**: se apoya solo en `Session.snapshot()`, así que UIA
  y SAP lo heredan sin escribir nada.
- Compara forma normalizada, no igualdad estricta: un `bounds` que oscila un píxel o un
  reloj que corre en la página no cuentan como "el árbol sigue cambiando". Una app con
  animación perpetua o un contador visible agotará el plazo — es el precio de no tener un
  observador de mutaciones nativo, y se detecta al primer uso.
- Cuesta un snapshot por sondeo. Por eso el paso admite `region` implícita del flujo y un
  `quietMs` corto: no es una espera para poner "por si acaso" en cada paso.
- **En el código generado no hay árbol universal**, así que los generadores traducen el
  paso a su equivalente nativo: un `MutationObserver` sobre el DOM con la misma ventana de
  silencio. Es la misma semántica (nada cambió durante `quietMs`) medida sobre el DOM en
  vez de sobre el árbol normalizado.

## Pendiente relacionado (no cerrado aquí)

El target `playwright-py` sigue sin el respaldo por label visual de ADR-0004: un campo
cuyo nombre el motor deduce del contenedor es inalcanzable en el script Python generado.
