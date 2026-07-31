# Universal UI Engine — monorepo de `uui-scan`

**El producto que se publica es [`uui-scan`](packages/uui-scan/README.md)**: escanea una
pantalla y devuelve el **catálogo de selectores** — cada campo con su `id`, su atributo
`name`, su tipo, si es obligatorio y con qué selector alcanzarlo. Se instala desde npm; no
hay que clonar este repo para usarlo.

```bash
npx uui-scan scan https://tuapp.com/login
```

Este repositorio es el motor que hay debajo: un modelo **universal** de UI (hoy Web; en el
roadmap Windows UIA y SAP GUI) con cuatro operaciones — `snapshot`, `scan`, `find`, `act` —
para que el mismo escáner sirva mañana contra una app de escritorio sin reescribir el
núcleo.

```
ui.scan({ target: "https://app/login" })             →  catálogo de selectores
ui.find({ nameContains: "Entrar", role: "button" })  →  uid=web:344
ui.act({ uid: "web:344", verb: "invoke" })           →  clic ejecutado
```

## Dos superficies, a propósito

`scan` **entrega** selectores; `snapshot`/`find` devuelven `uid` **opacos** que se
re-resuelven en cada acción. No es una inconsistencia: reportar y actuar son cosas
distintas (ADR-0006). Un selector guardado se pudre entre renders, y mantener separadas
las dos superficies hace difícil guardárselo hoy y actuar con él el mes que viene.

## Estado

| Pieza | Estado |
|---|---|
| Escáner web (`uui-scan scan`, `ui.scan`) | Funciona |
| Paquete npm `uui-scan` (CLI + MCP) | Empaquetado y probado desde un install limpio; sin publicar |
| Backend de escritorio (Windows UIA) | **No implementado.** El modelo ya lo contempla |
| Flujos + generación de código (F3) | Congelado: funciona y tiene tests, fuera del producto |

## Qué hace

- **Snapshot de una región de UI** como árbol de nodos con rol canónico (ARIA), nombre
  accesible, estados y capacidades — en modo `compact` (optimizado para el contexto de
  un LLM, con presupuesto de tokens medido en cada respuesta) o `full`.
- **Búsqueda determinista** por rol y/o nombre: mismo predicado, mismo resultado.
  Cada match devuelve el predicado que lo produjo, para que un flujo grabado sea
  reproducible.
- **Acciones robustas**: cada nodo declara qué verbos soporta (`invoke`, `setValue`,
  `toggle`, `expand`, `select`, `focus`, `scrollIntoView`). Las referencias a nodos
  (`uid`) no son handles vivos: se re-resuelven contra la UI real en el momento de
  actuar, con degradación automática de localizadores (testId → role+name → css →
  xpath → coords) — un re-render o un rediseño de CSS no rompe la acción.

## Arquitectura

Núcleo agnóstico + backends por tecnología + adaptadores de consumo. El núcleo no
importa ningún backend (aplicado por CI, no solo por convención) y jamás ramifica por
identidad de backend: pregunta capacidades del nodo, nunca "¿qué eres?".

```
                 ┌──────────────────────────────────┐
                 │        @uui/core (motor)         │
                 │  modelo de nodos · resolver de   │
                 │  locators · find · acciones ·    │
                 │  catálogo · serializador         │
                 └────────────────┬─────────────────┘
                                  │ contrato Backend (4 métodos)
              ┌───────────────────┼───────────────────┐
              │                   │                   │
      @uui/backend-web      backend-uia (F2)    backend-sap (F4)
       (Playwright)          [planificado]       [planificado]

        Adaptadores de consumo (hablan solo con @uui/core):
      ┌──────────────────────────┬──────────────────────────┐
      │  @uui/adapter-mcp        │  @uui/adapter-cli        │
      │  servidor MCP (stdio):   │  CLI: `scan` (producto)  │
      │  ui.snapshot / ui.scan / │  + snapshot/find/act     │
      │  ui.find / ui.act        │  (depuración del motor)  │
      └──────────────────────────┴──────────────────────────┘
```

Un backend nuevo implementa exactamente cuatro métodos (`query`, `probeLocator`,
`performAt`, `dispose`) y debe pasar la **suite de conformidad** de
`packages/core/conformance/` contra su propio fixture de referencia — la misma suite
para todos, escrita antes de que existiera el segundo backend para que describa el
contrato y no lo que un backend concreto hace.

## Instalación

**Para usarlo** no hace falta este repo:

```bash
npx uui-scan scan https://tuapp.com/login
```

**Para desarrollarlo** (lo que sigue en este README), Node ≥ 22 y pnpm ≥ 11:

```bash
git clone https://github.com/eriosgit/universal-ui-engine.git
cd universal-ui-engine
pnpm install
pnpm --filter @uui/backend-web exec playwright install chromium
pnpm build
```

## Uso

**El consumidor de este motor es un agente de IA, no un humano.** La forma prevista de
usarlo no es memorizar comandos: es conectarlo una vez a tu agente y pedírselo hablando.

### Conéctalo a tu agente (la forma principal)

Con Claude Code, un solo comando — sin clonar nada:

```bash
claude mcp add uui -- npx -y -p uui-scan uui-scan-mcp
```

Con cualquier otro cliente MCP (stdio), la configuración equivalente:

```json
{
  "mcpServers": {
    "uui": { "command": "npx", "args": ["-y", "-p", "uui-scan", "uui-scan-mcp"] }
  }
}
```

Si estás desarrollando este repo y quieres apuntar a tu clon en vez de al paquete
publicado, sustituye el comando por
`node "<ruta-al-repo>/packages/adapter-mcp/dist/src/server.js"`.

Y a partir de ahí, se lo pides en lenguaje natural:

> *«Escanea https://app.alegra.com y dime qué formularios tiene»*
>
> *«Entra a https://misitio.com/login con el usuario `ana`, contraseña `1234`, y dale a Entrar»*

El agente ve las cuatro herramientas del servidor — `ui.scan`, `ui.snapshot`, `ui.find`,
`ui.act` — y las usa solo. Para "¿cómo alcanzo este campo desde mi test?" elige `ui.scan`,
que devuelve el catálogo de selectores. Para "haz esto por mí" se orienta con un snapshot,
encuentra los controles por su **nombre accesible** ("Correo electrónico", "Entrar"…) y
actúa, sin selectores. Si no las elige por su cuenta, basta con decirle "usa las
herramientas de uui". La demo de referencia (un agente completa un login usando solo
snapshot/find/act) vive como prueba E2E en
`packages/adapter-mcp/test/demo-login.e2e.test.ts`.

### Páginas con sesión iniciada (tu dashboard, no un login)

El motor no usa tu Chrome: abre su propio navegador. Sin más, una app donde TÚ ya
estás logueado (`https://app.alegra.com`…) para el motor sería solo una página de
login. La solución es el **perfil persistente** (`~/.uui/profile`): inicias sesión una
vez, a mano, y desde entonces todo — CLI y agente — ve TU sesión:

```bash
pnpm uui login "https://app.alegra.com"
# → se abre un navegador visible; inicias sesión como siempre y CIERRAS el navegador.

pnpm uui snapshot "https://app.alegra.com"
# → ahora el snapshot es tu dashboard, no el login. Y el agente (MCP) también lo ve así.
```

Las sesiones sobreviven reinicios (son cookies reales en un perfil real de Chromium) y
expiran cuando la app las expire, como en cualquier navegador. `--clean` fuerza un
navegador sin estado; `--profile <dir>` (o `UUI_PROFILE_DIR` para el MCP) usa un perfil
alterno — p. ej. uno por cliente. Advertencia: el perfil admite un solo proceso a la
vez — cierra el navegador de `login` antes de escanear. Nota: algunos proveedores de
SSO (p. ej. "Iniciar sesión con Google") pueden rechazar navegadores automatizados;
si la app lo permite, usa su login de usuario/contraseña propio.

### El ciclo completo: descubrir una vez, automatizar siempre — CONGELADO

> **Fuera del producto que se publica.** Esta parte (F3) funciona y tiene tests, pero el
> foco es el escáner de selectores. Se documenta porque el código sigue aquí y porque el
> ciclo está medido; no se invierte más tiempo en ella por ahora. `waitForStable`
> ([ADR-0005](docs/adr/ADR-0005-espera-por-estabilidad-del-arbol.md)) salió de aquí.

La IA hace el trabajo caro **una sola vez** y lo que queda es código normal:

```bash
# 1. La IA explora la app con la CLI y descubre cómo se llaman los controles
pnpm uui find "https://miapp.com/facturas" "Nueva factura" --role button

# 2. Escribe un FLUJO declarativo (JSON versionable, revisable en un PR)
#    → ver examples/alegra-crear-servicio.flow.json

# 3. Se ejecuta sin IA y sin tokens, con validaciones
pnpm uui run mi-flujo.flow.json
#    OK  [ 0] Abrir ítems de venta (461ms)
#    ...
#    OK en 8622ms   { "servicioCreado": "Soporte técnico mensual" }

# 4. Se genera código autónomo (no depende de uui ni de una IA)
pnpm uui codegen mi-flujo.flow.json --target playwright-ts  --out automatizacion.ts
pnpm uui codegen mi-flujo.flow.json --target playwright-test --out flujo.spec.ts
pnpm uui codegen mi-flujo.flow.json --target playwright-py   --out automatizacion.py
```

Un flujo se compone de pasos deterministas: `goto`, `waitFor`, `waitForValue` (para
campos derivados que la app calcula sola), `act`, `expect` (validaciones — sin ellas un
flujo "termina bien" habiendo hecho nada) y `extract` (capturar datos del resultado).
Las esperas son **por condición, nunca por tiempo fijo**, que es lo que hace que la
automatización no sea intermitente. Ver
[`ADR-0004`](docs/adr/ADR-0004-flujos-y-generacion-de-codigo.md), incluida su limitación
conocida sobre formularios con labels no vinculados.

### CLI

`scan` es el comando de producto; el resto son utilidades para quien trabaja EN el motor
(o quiere ver crudo lo que el agente ve):

```bash
pnpm uui scan "https://ejemplo.com/login"                    # catálogo de selectores
pnpm uui scan "https://ejemplo.com" --out ./ui-scan          # escribe .json y .md
pnpm uui snapshot "https://ejemplo.com"                      # árbol de UI en JSON
pnpm uui snapshot "https://ejemplo.com" --filter-role form   # acotado por rol
pnpm uui find "https://ejemplo.com" "Guardar" --role button  # buscar por nombre
pnpm uui act "https://ejemplo.com" invoke --find "Entrar"    # actuar
```

Flags útiles: `--mode full`, `--depth N`, `--filter-name texto`, `--headed` (navegador
visible). Instalado desde npm, el binario es `uui-scan` en vez de `pnpm uui`.

### Publicar `uui-scan`

`packages/uui-scan/` empaqueta el workspace entero en un solo paquete con dos binarios
(`uui-scan`, `uui-scan-mcp`) usando esbuild. Se decidió bundlear en vez de publicar los
cinco `@uui/*` por separado: el usuario instala una herramienta, no un grafo de paquetes
internos, y los `workspace:*` no se pueden publicar tal cual.

```bash
pnpm build:pkg                        # incluido en `pnpm verify`
cd packages/uui-scan && npm publish
```

### App de referencia

`fixtures/web-app/` es una app estática versionada contra la que corren la suite de
conformidad, los golden trees y la demo. Para abrirla manualmente:

```bash
node fixtures/web-app/serve.mjs   # → http://localhost:4173
```

## Desarrollo

```bash
pnpm build       # tsc -b — construye los 4 paquetes en orden topológico
pnpm lint        # eslint (incluye la regla que bloquea ramificar core por backend)
pnpm deps        # dependency-cruiser: core no puede importar backend-*/playwright
pnpm test        # vitest: unitarias + conformidad + golden trees + tokens
pnpm verify      # los cuatro anteriores en secuencia — lo mismo que corre en CI
```

`pnpm build` debe correr antes de tocar paquetes downstream de `@uui/core`: con project
references, el typecheck de `backend-web`/`adapter-*` necesita los `.d.ts` emitidos.

`main` se mantiene limpio — todo el trabajo entra por PR desde ramas cortas
(`feat/...`), nunca por commit directo.

## Documentación

| Documento | Contenido |
|---|---|
| [`CONTEXT.md`](CONTEXT.md) | Glosario del dominio (nodo, locator, fingerprint, verbo…), invariantes no negociables, mapa del repo |
| [`docs/adr/ADR-0001-modelo-universal.md`](docs/adr/ADR-0001-modelo-universal.md) | El Modelo Universal de UI: qué es un `uid`, roles canónicos, poda de decorativos, coordenadas — con las alternativas descartadas y los bugs reales que ajustaron el diseño |
| [`docs/adr/ADR-0002-contrato-backend.md`](docs/adr/ADR-0002-contrato-backend.md) | El contrato core↔Backend: regiones perezosas, verbos por nodo, y por qué `if (backend === 'x')` es estructuralmente imposible |
| [`docs/adr/ADR-0003-presupuesto-de-tokens.md`](docs/adr/ADR-0003-presupuesto-de-tokens.md) | Por qué un snapshot costaba 6.811 tokens en una pantalla vacía y qué se hizo: modo `actionable`, colapso de envoltorios y resumen del cromo persistente — con lo medido y lo que aún falta |
| [`docs/adr/ADR-0004-flujos-y-generacion-de-codigo.md`](docs/adr/ADR-0004-flujos-y-generacion-de-codigo.md) | Flujos declarativos, esperas por condición, validaciones y generación de código autónomo — el ciclo "descubrir una vez, ejecutar siempre", con sus resultados medidos y su limitación conocida |
| [`docs/specs/`](docs/specs/) | Una spec por unidad de trabajo, con criterios de aceptación y evidencia |
| [`CLAUDE.md`](CLAUDE.md) | Flujo de trabajo para agentes de IA que desarrollan en este repo |

## Estado

**F0 — esqueleto caminante: completo.** Motor + backend Web + CLI + MCP + suite de
conformidad + demo de login end-to-end, con CI de cuatro gates en verde. Fases
siguientes: robustez de localización (F1), backend Windows UIA — la fase que pone a
prueba la hipótesis del modelo universal — (F2), grabador y generación de código (F3),
SAP GUI (F4).

## Licencia

Privado. Todos los derechos reservados.
