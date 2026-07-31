# uui-scan

Escanea una pantalla y te devuelve **los selectores**, ordenados y listos para pegar en tu
proyecto: cada campo con su `id`, su atributo `name`, su tipo, si es obligatorio, sus
opciones, y el selector recomendado con sus respaldos.

No hay que clonar nada ni meterse en la carpeta del proyecto.

```bash
npx uui-scan scan https://tuapp.com/login
```

```markdown
## Iniciar sesión

### Campos
| Campo      | id       | name     | tipo    | req | selector                  |
|------------|----------|----------|---------|:---:|---------------------------|
| Usuario    | username | username | textbox | sí  | `login-username` (testId) |
| Contraseña | password | password | textbox | sí  | `login-password` (testId) |

### Acciones
| Acción | tipo   | selector                |
|--------|--------|-------------------------|
| Entrar | button | `login-submit` (testId) |
```

## Por qué no es otro volcado del DOM

**Encuentra los campos que el DOM no nombra.** Muchísimas apps reales pintan
`<div><label>Nombre*</label><input/></div>` sin vincular el label con `for`/`id`. Un lector
de pantalla no los asocia, y `getByRole` tampoco los encuentra. `uui-scan` sí: deduce el
nombre del contenedor, acotado (un solo label y un solo control) para no robarle la
etiqueta al campo vecino. Sin eso, formularios enteros salen sin nombre.

**Ordena los selectores por robustez, no te da uno y ya.** `testId` (0.95) → `id` (0.9) →
atributo `name` (0.85) → rol+nombre (0.8) → CSS (0.6) → XPath (0.55). Los tres primeros
solo se emiten si identifican a **uno**: los `id` duplicados existen en apps reales. Las
coordenadas nunca aparecen — no le sirven a nadie pegadas en un proyecto.

**Colapsa las repeticiones.** Una tabla de 20 filas no son 20 entradas idénticas con rutas
CSS de 200 caracteres: es una entrada con `×20` y el índice parametrizado.

```
| Editar ×20 | button | `… tr:nth-child({n}) > td:nth-child(2) > button` (css · 20 elementos) |
```

**Espera a que la pantalla se asiente.** Una SPA renderiza por etapas, y capturar a
destiempo devuelve un catálogo corto **con toda la apariencia de estar completo** — que es
peor que un error, porque no te enteras. Medido contra una app real: tres escaneos de la
misma URL daban 960, 207 y 207 nodos. Con la espera: 905, 905, 905. Se desactiva con
`--no-wait` si la página es estática.

**Ve tu sesión.** `uui-scan login <url>` abre un navegador visible, inicias sesión a mano y
se guarda el perfil. A partir de ahí escaneas pantallas detrás del login sin automatizar
credenciales ni guardarlas en ningún sitio.

## Uso

```bash
# Escanear e imprimir en la terminal
npx uui-scan scan https://tuapp.com/login

# Escribir login.json + login.md
npx uui-scan scan https://tuapp.com/login --out ./ui-scan

# Solo una región (evita escanear el menú y la cabecera enteros)
npx uui-scan scan https://tuapp.com/facturas --filter-role form

# Guardar tu sesión primero, para escanear pantallas privadas
npx uui-scan login https://tuapp.com
```

| Opción | Para qué |
|---|---|
| `--out <dir>` | escribe `<nombre>.json` y `<nombre>.md` |
| `--format json` | por stdout; por defecto imprime Markdown |
| `--name <archivo>` | nombre base de los archivos (si no, se deriva de la URL) |
| `--filter-role <rol>` · `--filter-name <texto>` | acota el escaneo a una región |
| `--quiet-ms <n>` | ms sin cambios antes de capturar (500 por defecto) |
| `--no-wait` | captura de inmediato, sin esperar a la SPA |
| `--clean` | navegador sin tu perfil |
| `--headed` | navegador visible |
| `--profile <dir>` | perfil alterno — p. ej. uno por cliente |

## Como servidor MCP

Para que tu agente escanee por ti, en el `.mcp.json` de tu proyecto:

```json
{
  "mcpServers": {
    "uui": { "command": "npx", "args": ["-y", "-p", "uui-scan", "uui-scan-mcp"] }
  }
}
```

Expone cuatro herramientas: `ui.scan` (el catálogo), `ui.snapshot` (árbol de UI barato,
optimizado para tokens), `ui.find` y `ui.act`.

Solo `ui.scan` devuelve selectores. Las otras tres devuelven identificadores **opacos** que
se re-resuelven en cada acción, a propósito: un selector guardado se pudre entre renders, y
la separación hace difícil guardárselo y actuar con él tres días después. Reportar y actuar
son cosas distintas.

## Instalación

```bash
npx uui-scan …          # sin instalar nada
npm i -g uui-scan       # o global
```

Requiere Node 20+. La primera ejecución descarga Chromium vía Playwright.

## Estado

Web funciona. **Escritorio todavía no**: el modelo de datos ya está diseñado para ello
(`automationId` ↔ `AutomationId`, `required` ↔ `IsRequiredForForm`, `options` ↔
`SelectionPattern`), pero el backend de UI Automation no está implementado. Si lo que
necesitas es escanear una app de escritorio Windows, este paquete todavía no te sirve.

MIT.
