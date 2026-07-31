# ADR-0001: Modelo Universal de UI v0.1

- **Estado:** Aceptado
- **Fecha:** cierre de la sesión de grilling previa a F0
- **Decide:** humano (§5.5 del plan — el modelo universal no se delega a la IA)

## Contexto

`Plan_Desarrollo_Universal_UI_v2.md` §3 deja abiertas cinco decisiones sobre el Modelo
Universal de UI y pide explícitamente correrlas por una sesión de `/grilling` antes de
escribir código (§8, paso 1), porque §5.5 clasifica el modelo como una de las decisiones
que no se delegan a la IA. Este ADR registra el resultado de esa sesión.

## Decisiones

### D1 — `uid` = locator re-resoluble, no handle

El `uid` es una etiqueta **opaca de sesión** que apunta a un *fingerprint* re-resoluble
(locators ordenados por robustez + ruta estructural podada). Se resuelve contra el
backend **en el momento de usarlo** (`ui.act`), nunca antes, con degradación ordenada
(ver ADR-0002 / `resolver.ts`).

**Alternativas descartadas:**
- *Handle vivo del backend* (tabla `uid → ElementHandle`/`AutomationElement`): rápido,
  pero los handles mueren en cada re-render web y cuando UIA destruye el elemento — sin
  recuperación posible. Ata el núcleo a un ciclo de vida que no controla.
- *Hash puro de propiedades* (`uid = hash(role+name+ruta+props)`): stateless y
  reproducible, pero colisiona en listas homogéneas (20 filas con el mismo botón
  "Editar" — exactamente el escenario que `fixtures/web-app` mete a propósito) y cambia
  con cualquier re-render, que es justo cuando NO debería cambiar.

**Consecuencia:** el núcleo nunca sostiene objetos vivos del backend. `Session` (núcleo)
mantiene el único registro `uid → fingerprint`; `act()` siempre re-resuelve antes de
actuar (`resolver.ts::resolveFingerprint`).

### D3 — `role` enum cerrado + `nativeRole` de primera clase

`role` es un enum ARIA canónico, cerrado y versionado (`packages/core/src/types.ts`,
`ROLES`). `nativeRole: string` es un campo de **primera clase**, fuera de `raw`, legible
por el núcleo y por `ui.find`.

Esto corrige un defecto real del §3 original: el plan declara que `raw` "NUNCA es leída
por el núcleo", pero si el rol nativo del backend viviera ahí, `ui.find` no podría
filtrar por él. Un control sin mapeo (`GuiGridView` de SAP, `UserControl` de WPF) cae en
`role: 'generic'` sin perder información — `nativeRole` sigue disponible.

**Alternativa descartada:** vocabulario abierto normalizado (string libre + mapa de
normalización por backend) — máximo margen para controles exóticos, pero `ui.find({role})`
deja de ser verificable estáticamente y los golden trees derivan silenciosamente entre
versiones de backend.

**Consecuencia:** agregar un rol al enum exige un ADR + actualizar golden trees. Fricción
deliberada.

### D4 — Marcar en el backend, podar en el serializador

El backend calcula `decorative: boolean` con reglas declarativas propias (para
backend-web: rol `generic`, sin nombre accesible, sin verbo *significativo* — ver nota
de implementación abajo). La poda ocurre **solo al serializar** (`serialize.ts`):

- `compact`: elimina nodos `decorative` y **reparenta** sus hijos al ancestro no
  decorativo más cercano. Sin reparentar, `compact` perdería contenido real (p. ej. los
  campos de un formulario envueltos en `div`s de maquetación).
- `full`: los conserva.

La información nunca se destruye río arriba del serializador.

**Nota de implementación (backend-web):** un nodo cuenta como "sin interacción real" si,
tras excluir `scrollIntoView` y `focus` (capacidades casi universales que cualquier
elemento visible tiene en mayor o menor medida), no le queda ningún verbo. Sin esta
exclusión, NINGÚN nodo calificaría jamás como decorativo — se descubrió este defecto
ejercitando la suite de conformidad contra `fixtures/web-app` en C3, no se anticipó en la
sesión de grilling.

**Invariante derivado:** la raíz de una región nunca puede ser `decorative` — es el
ancla que el consumidor pidió explícitamente. `serialize.ts::pruneDecorative` lo hace
cumplir lanzando si el backend lo marcara así. `backend-web` fuerza `decorative: false`
para el nodo en profundidad 0 de cada `query()` (ver `pageScript.ts::walk`) precisamente
porque `document.body` —la raíz por defecto— normalmente no tiene rol semántico ni
nombre propio y, sin este caso especial, se podaría a sí mismo.

### D5 — `bounds` absolutos de pantalla, DPI-aware, informativos

`bounds` son absolutos de escritorio, en píxeles físicos, con el proceso declarado
PerMonitorV2 DPI-aware (para backends OS-level). Son **informativos**: como el `uid` se
re-resuelve antes de actuar (D1), un `bounds` obsoleto nunca causa un clic erróneo.
`compact` los omite.

Cada nodo raíz de un marco de coordenadas propio (ventana/documento/iframe) puede llevar
un `origin: {x,y}` — el resto de los `bounds` del subárbol se interpretan relativos a él.

**Especialización por backend-web (ver también ADR-0002):** Playwright no expone la
posición de la ventana del sistema operativo en la pantalla física — solo backends
OS-level (UIA) pueden dar un origin de escritorio verdadero. Para backend-web, `origin`
se deja siempre ausente: sin iframes anidados, todo `bounds` ya vive en el único frame de
la página (su propio viewport), y "absoluto de escritorio" se reduce a "absoluto del
frame superior de la página". Esto no es una desviación de D5 — es exactamente para lo
que el mecanismo `origin` (per-root, no global) fue diseñado.

### D7 — `find` determinista, con capa semántica encima

El núcleo de `find` (`packages/core/src/find.ts`) son predicados deterministas y
componibles: `role`, `nameContains`, `and`. Un ranking semántico (F1 — "consulta
semántica → nodo") es una capa que rankea ENCIMA, y debe devolver, junto al nodo, el
predicado determinista que usó.

**Por qué:** sin esto, F3 (generación de código a partir de flujos grabados) es
imposible — no se puede generar un selector Rocketbot reproducible a partir de "lo que el
modelo entendió ese día". F0 implementa solo el subconjunto que el MCP necesita
(`role`/`nameContains`/`and`); `ancestor`/`descendant` y el ranking semántico son F1.

## Modelo resultante

```ts
type UINode = {
  uid: string;                 // opaco, de sesión (D1)
  role: Role;                  // enum canónico ARIA, cerrado (D3)
  nativeRole: string;          // primera clase, legible por core (D3)
  name: string | null;
  value?: string | null;
  states: Set<State>;
  bounds: Rect | null;         // absoluto, informativo (D5)
  origin?: { x: number; y: number };
  decorative: boolean;         // lo marca el backend; lo consume el serializador (D4)
  supports: Verb[];            // capacidades DEL NODO (ver ADR-0002, D6)
  locators?: Locator[];        // interno — nunca serializado a un consumidor
  children: UINode[];
  backend: BackendId;
  raw?: unknown;               // escotilla por backend, nunca leída por core
};
```

Ver `packages/core/src/types.ts` para la fuente de verdad actual (este ADR puede quedar
desactualizado en detalles menores; el código manda).

## Addenda post-implementación

### `status` agregado al enum de roles (D3)

Implementando la demo de C7 (login vía las 3 herramientas MCP), el párrafo de estado del
formulario (`role="status" aria-live="polite"`) no tenía representación: `status` no
estaba en el enum `ROLES`, así que caía en `generic` — y `generic` no está en el conjunto
de roles cuyo nombre se computa "desde el contenido" (`NAME_FROM_CONTENT_ROLES` en
`pageScript.ts`), así que su texto ("Sesión iniciada como dev2") nunca llegaba a ser su
`name`. `ui.find({nameContains: 'Sesión iniciada'})` no encontraba nada — la demo fallaba
en el último paso, no antes.

Se agregó `status` al enum (junto a `alert`, con quien comparte semántica de "region
viva") y a `NAME_FROM_CONTENT_ROLES`. Exactamente la fricción que D3 anticipa como
deliberada: agregar un rol exige tocar el enum Y regenerar los golden trees
(`packages/backend-web/test/__snapshots__/golden.test.ts.snap`) — ambos se hicieron en el
mismo cambio.
