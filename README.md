# Universal UI Engine

Motor de exploración y automatización **universal** de interfaces de usuario, diseñado
para ser consumido por agentes de IA. Expone cualquier UI (hoy: Web; en el roadmap:
Windows UIA y SAP GUI) como un **modelo único de nodos** con tres operaciones —
`snapshot`, `find`, `act` — de modo que un agente pueda ver una pantalla, encontrar un
control por su nombre accesible y actuar sobre él **sin escribir un solo selector a
mano**, y sin que le importe qué tecnología hay debajo.

```
ui.find({ nameContains: "Entrar", role: "button" })  →  uid=web:344
ui.act({ uid: "web:344", verb: "invoke" })           →  clic ejecutado
```

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
                 │  serializador (compact/full)     │
                 └────────────────┬─────────────────┘
                                  │ contrato Backend (4 métodos)
              ┌───────────────────┼───────────────────┐
              │                   │                   │
      @uui/backend-web      backend-uia (F2)    backend-sap (F4)
       (Playwright)          [planificado]       [planificado]

        Adaptadores de consumo (hablan solo con @uui/core):
      ┌──────────────────────────┬──────────────────────────┐
      │  @uui/adapter-mcp        │  @uui/adapter-cli        │
      │  servidor MCP (stdio):   │  CLI `uui`: depuración   │
      │  ui.snapshot / ui.find / │  humana y bucle de       │
      │  ui.act                  │  desarrollo              │
      └──────────────────────────┴──────────────────────────┘
```

Un backend nuevo implementa exactamente cuatro métodos (`query`, `probeLocator`,
`performAt`, `dispose`) y debe pasar la **suite de conformidad** de
`packages/core/conformance/` contra su propio fixture de referencia — la misma suite
para todos, escrita antes de que existiera el segundo backend para que describa el
contrato y no lo que un backend concreto hace.

## Instalación

Requisitos: Node ≥ 22, pnpm ≥ 11.

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

Con Claude Code, un solo comando (ajusta la ruta a tu clon):

```bash
claude mcp add uui -- node "<ruta-al-repo>/packages/adapter-mcp/dist/src/server.js"
```

Con cualquier otro cliente MCP (stdio), la configuración equivalente:

```json
{
  "mcpServers": {
    "uui": {
      "command": "node",
      "args": ["<ruta-al-repo>/packages/adapter-mcp/dist/src/server.js"]
    }
  }
}
```

Y a partir de ahí, se lo pides en lenguaje natural:

> *«Escanea https://app.alegra.com y dime qué formularios tiene»*
>
> *«Entra a https://misitio.com/login con el usuario `ana`, contraseña `1234`, y dale a Entrar»*

El agente ve las tres herramientas del servidor — `ui.snapshot`, `ui.find`, `ui.act` —
y las usa solo: se orienta con un snapshot, encuentra los controles por su **nombre
accesible** ("Correo electrónico", "Entrar"…) y actúa. Sin selectores, sin flags, sin
que tú toques la terminal. Si el agente no las elige por su cuenta, basta con decirle
"usa las herramientas de uui". La demo de referencia (un agente completa un login usando
solo esas tres herramientas) vive como prueba E2E en
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

### CLI (`uui`) — para desarrollar y depurar el motor

La CLI existe para quien trabaja EN el motor (o quiere ver crudo lo que el agente ve),
no como interfaz de producto:

```bash
pnpm uui snapshot "https://ejemplo.com"                      # árbol de UI en JSON
pnpm uui snapshot "https://ejemplo.com" --filter-role form   # acotado por rol
pnpm uui find "https://ejemplo.com" "Guardar" --role button  # buscar por nombre
pnpm uui act "https://ejemplo.com" invoke --find "Entrar"    # actuar
```

Flags útiles: `--mode full`, `--depth N`, `--filter-name texto`, `--headed` (navegador
visible). Un agente con acceso a terminal (p. ej. Claude Code sin el MCP registrado)
también puede usarla directamente si le indicas la ruta del repo.

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
