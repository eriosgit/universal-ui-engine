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

### CLI (`uui`)

```bash
# Snapshot compacto de una página, filtrado por rol
node packages/adapter-cli/dist/src/cli.js snapshot "https://ejemplo.com" --filter-role form

# Buscar un control por nombre accesible
node packages/adapter-cli/dist/src/cli.js find "https://ejemplo.com" "Guardar" --role button

# Actuar: escribir en un campo, hacer clic — sin selectores
node packages/adapter-cli/dist/src/cli.js act "https://ejemplo.com" setValue --find "Usuario" --value "dev2"
node packages/adapter-cli/dist/src/cli.js act "https://ejemplo.com" invoke --find "Entrar" --role button
```

Flags útiles: `--mode full`, `--depth N`, `--filter-name texto`, `--headed` (navegador
visible).

### Servidor MCP

Para conectarlo a un agente (Claude Code, o cualquier cliente MCP por stdio):

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

Expone exactamente tres herramientas — `ui.snapshot`, `ui.find`, `ui.act` — cada una con
su presupuesto de tokens declarado en la descripción. La demo de referencia (un agente
completa un login usando solo esas tres herramientas) vive como prueba E2E en
`packages/adapter-mcp/test/demo-login.e2e.test.ts`.

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
