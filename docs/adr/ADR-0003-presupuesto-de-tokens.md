# ADR-0003: Presupuesto de tokens — proyecciones y cromo persistente

- **Estado:** Aceptado
- **Fecha:** primer uso real del motor contra una app SaaS de terceros
- **Contexto de origen:** medición, no diseño anticipado

## Contexto

§3 del plan fija un objetivo de p95 < 3.000 tokens por snapshot. F0 lo cumplía contra
`fixtures/web-app`, pero el primer uso real —un dashboard de Alegra con sesión iniciada—
lo desmintió: **6.811 tokens para una pantalla VACÍA** ("¡Aún no tienes pagos!").

Medición que abrió la investigación:

| Petición | Tokens |
|---|---|
| `snapshot` completo | 6.811 |
| Anclado al módulo (`root=uid`) | 803 |
| Solo los botones (`find`) | 224 |

**115 de 136 nodos eran el menú lateral.** El diagnóstico: el motor reenviaba el cromo
persistente entero en cada snapshot, y las escapatorias de §3 (`root`/`filter`) existían
pero el *default* era malo — obligaba al consumidor a saber de antemano dónde acotar.

## Decisiones

### D8 — `listitem` fuera de los roles con nombre desde el contenido (corrección de defecto)

`NAME_FROM_CONTENT_ROLES` en `backend-web` incluía `listitem`, que **no** está en la lista
de la especificación (ARIA 1.2 §5.2.8.5). Consecuencia real: un `listitem` que envuelve un
submenú recibía como nombre la concatenación del texto de todos sus descendientes
(`"ingresosfactura de ventafacturas de venta recurrentespagos recibidos…"`) — el mismo
contenido pagado dos veces, en el padre y en cada hijo.

`alert` y `status` **sí** se mantienen como desviación deliberada: son regiones vivas
donde el texto ES la información que el agente necesita leer, no un mero rótulo.

### D9 — Colapso de envoltorios redundantes en `compact`

Un nodo se funde con su único hijo cuando (a) no declara ningún verbo significativo, y
(b) o no tiene nombre propio, o tiene exactamente el mismo que el hijo. Caso canónico:
`listitem "inicio" > link "inicio"` — dos nodos, un solo dato.

Conservador a propósito: con dos o más hijos la jerarquía sí agrupa información, y un
nodo accionable nunca se colapsa. La raíz tampoco (mismo invariante que D4).

### D10 — Modo `actionable`, y como default del MCP

Tercera proyección junto a `compact`/`full`: solo los nodos con un verbo *significativo*
(`invoke`, `setValue`, `toggle`, `expand`, `select` — no `focus`/`scrollIntoView`, que son
casi universales) más los `heading`, que dan contexto: once botones sueltos no dicen en
qué sección están.

Responde a la pregunta que un agente hace de verdad —"¿qué puedo hacer aquí?"— en vez de
"describe todo lo que hay". `ui.snapshot` del MCP lo usa por defecto y su descripción
instruye a empezar por ahí.

### D11 — El cromo persistente se resume tras la primera vez

`Session` recuerda las firmas (`rol + nombre + capacidades`, nunca el `uid`, que cambia
por diseño) de los nodos hoja ya enviados. Un nodo que reaparece **idéntico en una
pantalla distinta** es, por definición, cromo — menú, cabecera, pie — no contenido de la
pantalla actual. Series consecutivas de hermanos ya vistos se resumen en un nodo
`collapsed: true` que enumera sus nombres.

**Es una definición precisa, no una heurística**: no adivina "esto parece un menú",
constata "esto ya estaba en la pantalla anterior, idéntico".

**Nada se pierde**: `ui.find` recorre siempre el árbol completo, así que el agente
localiza por nombre cualquier elemento resumido en cuanto quiera actuar sobre él. El
primer snapshot de una sesión siempre llega íntegro.

Requiere un campo nuevo en el modelo (`UINode.collapsed?`) y estado nuevo en `Session`
(`seenSignatures`) — de ahí que esto sea un ADR y no un refactor.

## Resultados medidos (mismo dashboard real)

| Escenario | Antes | Después |
|---|---|---|
| Pantalla de seguimiento (`actionable`) | 6.811 | **3.641** |
| Sesión de 3 pantallas, acumulado | ~20.433 | **12.646** |

## Lo que NO resuelve (honestidad de alcance)

El objetivo de 3.000 por snapshot **todavía no se cumple** en una pantalla de seguimiento
de esta app (3.641). Lo que queda por atacar:

- El resumen solo colapsa **series consecutivas** de hermanos ya vistos; cuando el cromo
  viene intercalado con contenido nuevo, las series se rompen y cada fragmento sobrevive.
- `Session` está atada a una URL en el servidor MCP (`getSession(target)`), así que el
  ahorro solo aparece si la MISMA sesión navega entre pantallas. Que una `Session`
  corresponda a un contexto de navegador —y no a una URL— es más fiel a D1 y habilitaría
  el ahorro siempre; es un refactor pendiente.
- `row` sigue tomando nombre del contenido (`"Cliente 1Editar"`): es correcto según la
  spec, pero duplica. Cambiarlo exige más justificación que este ADR.

Estas tres quedan como trabajo de F1, con la medición ya hecha para saber si mejoran.
