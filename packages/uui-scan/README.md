# uui-scan

Escanea una pantalla web y te devuelve **los selectores**, ordenados y listos para pegar en
tu proyecto: cada campo con su `id`, su atributo `name`, su tipo, si es obligatorio, si está
deshabilitado, sus opciones, y el selector recomendado con sus respaldos.

```bash
npx uui-scan scan https://tuapp.com/login
```

```markdown
# Escaneo de UI

**Objetivo:** https://tuapp.com/login
**Escaneado:** 2026-07-31T18:02:34.529Z
**Nodos examinados:** 10

## Iniciar sesión

### Campos
| Campo      | id       | name     | tipo    | req | estado | selector                  |
|------------|----------|----------|---------|:---:|--------|---------------------------|
| Usuario    | username | username | textbox | sí  | —      | `login-username` (testId) |
| Contraseña | password | password | textbox | sí  | —      | `login-password` (testId) |

### Acciones
| Acción | tipo   | selector                |
|--------|--------|-------------------------|
| Entrar | button | `login-submit` (testId) |
```

No hay que clonar nada ni instalar el repo.

**Contenido:** [Los dos ejecutables](#los-dos-ejecutables) · [Instalación](#instalación) ·
[`scan`](#scan--el-comando-principal) · [`login`](#login--escanear-detrás-de-autenticación) ·
[**Referencia de la salida**](#referencia-de-la-salida)
([Markdown](#markdown) · [JSON](#json) · [Tipos de selector](#tipos-de-selector)) ·
[Servidor MCP](#servidor-mcp) · [Cómo funciona](#cómo-funciona) ·
[Avanzado](#avanzado-utilidades-del-motor) · [Límites](#límites-conocidos) ·
[Problemas frecuentes](#problemas-frecuentes)

---

## Los dos ejecutables

El paquete instala **dos** programas sobre el mismo motor. No es solo un servidor MCP:

| Ejecutable | Qué es | Para quién |
|---|---|---|
| `uui-scan` | CLI de terminal | Tú, escribiendo comandos |
| `uui-scan-mcp` | Servidor MCP (stdio) | Tu agente (Claude Code, Cursor…), que escanea por ti |

Puedes usar uno, el otro, o los dos. Ver [Servidor MCP](#servidor-mcp).

---

## Instalación

```bash
npx uui-scan scan <url>     # sin instalar nada
npm i -g uui-scan           # o instalado global
```

**Requiere Node 20 o superior.**

**Chromium.** Playwright lo descarga en su *postinstall*, no en la primera ejecución. Si tu
entorno instala con los scripts deshabilitados —algunos hosts de MCP y algunos CI lo
hacen— verás `Executable doesn't exist`. Se arregla con:

```bash
npx playwright install chromium
```

---

## `scan` — el comando principal

```bash
# Imprimir el catálogo en la terminal
npx uui-scan scan https://tuapp.com/login

# Escribir login.json + login.md en ./ui-scan
npx uui-scan scan https://tuapp.com/login --out ./ui-scan

# Acotar a una región (evita escanear el menú y la cabecera enteros)
npx uui-scan scan https://tuapp.com/facturas --filter-role form

# JSON por stdout, para encadenar con jq u otro script
npx uui-scan scan https://tuapp.com/login --format json | jq '.groups[0].fields'
```

| Opción | Por defecto | Qué hace |
|---|---|---|
| `-o, --out <dir>` | — | Escribe `<nombre>.json` y `<nombre>.md` en ese directorio |
| `--name <nombre>` | derivado de la URL | Nombre base de los archivos (`/auth/login` → `auth-login`) |
| `--format <md\|json>` | `md` | Qué imprimir por stdout cuando no usas `--out` |
| `--filter-role <rol>` | — | Acota el escaneo a las regiones con ese rol (`form`, `dialog`, `main`…) |
| `--filter-name <texto>` | — | Acota a las regiones cuyo nombre contenga ese texto |
| `--quiet-ms <n>` | `500` | Milisegundos sin cambios en la pantalla antes de capturar |
| `--no-wait` | — | Captura de inmediato, sin esperar a que la SPA se asiente |
| `--clean` | — | Navegador limpio, ignorando tu perfil guardado |
| `--headed` | — | Abre el navegador visible en vez de headless |
| `--profile <dir>` | `~/.uui/profile` | Perfil alterno — p. ej. uno por cliente |

---

## `login` — escanear detrás de autenticación

La mayoría de las pantallas que te interesan están tras un login. `uui-scan` no automatiza
credenciales ni las guarda: abre un navegador visible, **inicias sesión tú a mano**, y la
sesión queda en un perfil de Chromium normal.

```bash
npx uui-scan login https://tuapp.com
# Se abre un navegador. Inicias sesión como siempre y CIERRAS la ventana.

npx uui-scan scan https://tuapp.com/facturas
# Ahora esto ve TU sesión, no la página de login.
```

| Opción | Por defecto | Qué hace |
|---|---|---|
| `--profile <dir>` | `~/.uui/profile` | Dónde se guarda la sesión |

Las sesiones sobreviven reinicios y expiran cuando la app las expire. El perfil admite **un
solo proceso a la vez**: cierra el navegador de `login` antes de escanear.

**El navegador no se anuncia como automatizado.** Chromium enciende `navigator.webdriver`
por el mero hecho de arrancar desde código, y algunos proveedores de identidad rechazan la
ventana por eso — cuando aquí hay una persona escribiendo su contraseña, no un bot.
`uui-scan` lanza con `--disable-blink-features=AutomationControlled`, así que
`navigator.webdriver` vale `false`.

No es un modo indetectable: sigue siendo Chromium bajo control de Playwright y hay más
señales. Y en **headless el User-Agent sigue diciendo "Headless"**, que ninguna bandera
tapa; si un login discrimina por eso, usa `--headed`.

**Qué se guarda y dónde.** Un perfil de Chromium normal en `~/.uui/profile` (en Windows,
`C:\Users\<tú>\.uui\profile`) — las mismas cookies que tendría cualquier navegador. Nada
sale de tu máquina. Para cerrar la sesión, borra ese directorio:

```bash
rm -rf ~/.uui/profile          # Linux/macOS
rmdir /s "%USERPROFILE%\.uui\profile"   # Windows
```

Con `--profile <dir>` puedes tener uno por cliente, y `--clean` ignora el perfil por
completo.

---

## Referencia de la salida

Ambos formatos salen del mismo objeto: el Markdown es para leer y pegar en un PR, el JSON
para procesar.

### Markdown

Encabezado con el objetivo, la fecha y cuántos nodos se examinaron. Después, un bloque por
cada contenedor (`<form>`, diálogo, región…) con dos tablas.

**Tabla de campos** — lo que el usuario rellena:

| Columna | Qué contiene |
|---|---|
| `Campo` | El nombre por el que un humano llama al campo en la pantalla |
| `id` | Atributo `id`, solo si identifica a un único elemento |
| `name` | Atributo `name`, solo si identifica a un único elemento |
| `tipo` | Tipo nativo del control: `textbox`, `combobox`, `checkbox`, `switch`… |
| `req` | `sí` si es obligatorio (`required` o `aria-required`) |
| `estado` | `deshabilitado`, `solo lectura`, o `—` |
| `selector` | El selector recomendado, con su tipo entre paréntesis |

**Tabla de acciones** — lo que el usuario pulsa: botones, enlaces, pestañas.

Debajo de las tablas, cuando aplica, aparecen dos listas: los campos con **texto de ayuda**
(su `placeholder` o `aria-describedby`) y los que **admiten opciones** (un `<select>`).

**Marcas que verás:**

| Marca | Significa |
|---|---|
| `Editar ×20` | Una entrada resume 20 elementos idénticos (una tabla) |
| `tr:nth-child({n})` | El índice está parametrizado: sustituye `{n}` por el número de fila |
| `⚠️ N elementos interactivos quedaron fuera` | Hubo controles que no se pudieron clasificar, con el conteo por rol |

### JSON

```json
{
  "target": "https://tuapp.com/login",
  "scannedAt": "2026-07-31T18:02:34.529Z",
  "nodesScanned": 10,
  "interactiveSkipped": 0,
  "interactiveSkippedByRole": {},
  "groups": [
    {
      "name": "Iniciar sesión",
      "role": "form",
      "fields": [
        {
          "name": "Usuario",
          "role": "textbox",
          "nativeRole": "textbox",
          "automationId": "username",
          "attrName": "username",
          "description": null,
          "options": null,
          "value": "",
          "required": true,
          "readonly": false,
          "disabled": false,
          "selector": { "kind": "testId", "value": "login-username", "confidence": 0.95 },
          "fallbacks": [
            { "kind": "automationId", "value": "username", "confidence": 0.9 },
            { "kind": "css", "value": "form > div:nth-child(1) > input", "confidence": 0.6 }
          ],
          "occurrences": 1,
          "patternSelector": null
        }
      ],
      "actions": []
    }
  ]
}
```

**Raíz:**

| Campo | Tipo | Qué es |
|---|---|---|
| `target` | `string` | La URL escaneada |
| `scannedAt` | `string` | ISO 8601. Un catálogo sin fecha miente: los selectores caducan |
| `nodesScanned` | `number` | Cuántos nodos se examinaron; sirve para detectar un escaneo parcial |
| `interactiveSkipped` | `number` | Controles interactivos que no se supieron clasificar |
| `interactiveSkippedByRole` | `object` | Qué roles fueron y cuántos de cada uno |
| `groups` | `array` | Un grupo por contenedor con contenido |

**Grupo:** `name` (nombre del contenedor, o `null`), `role`, `fields[]`, `actions[]`.

**Entrada (`fields[]` y `actions[]`):**

| Campo | Tipo | Qué es |
|---|---|---|
| `name` | `string \| null` | Nombre accesible |
| `role` | `string` | Rol ARIA canónico |
| `nativeRole` | `string` | Rol tal cual lo dedujo el motor |
| `automationId` | `string \| null` | El `id` (en escritorio será el `AutomationId`) |
| `attrName` | `string \| null` | El atributo `name`, si es único |
| `description` | `string \| null` | Texto de ayuda: `placeholder`, `aria-describedby` o `title` |
| `options` | `string[] \| null` | Opciones de un control de selección. `null` si no selecciona |
| `value` | `string \| null` | Valor actual |
| `required` | `boolean` | Campo obligatorio |
| `readonly` | `boolean` | Solo lectura |
| `disabled` | `boolean` | Deshabilitado |
| `selector` | `object \| null` | El recomendado: `{ kind, value, confidence }` |
| `fallbacks` | `array` | Los demás, de más a menos robusto |
| `occurrences` | `number` | Cuántos elementos resume esta entrada. `1` es lo normal |
| `patternSelector` | `string \| null` | Selector con el índice como `{n}`, si se colapsaron |

### Tipos de selector

De más a menos robusto. El catálogo siempre recomienda el primero disponible:

| `kind` | Confianza | Cuándo se emite |
|---|---|---|
| `testId` | 0.95 | Hay `data-testid` **y** identifica a un único elemento |
| `automationId` | 0.90 | Hay `id` **y** es único en el documento |
| `attrName` | 0.85 | Hay atributo `name` **y** es único |
| `role+name` | 0.80 | La pareja rol + nombre accesible es única |
| `css` | 0.60 | Ruta CSS completa. Siempre disponible, se rompe con cualquier rediseño |
| `xpath` | 0.55 | Ruta XPath completa |
| `coords` | — | **Nunca aparece en el catálogo.** No le sirve a nadie pegado en un proyecto |

Los tres primeros solo se emiten si identifican a **uno**: los `id` duplicados existen en
apps reales, y un selector que casa con tres elementos no es un selector.

---

## Servidor MCP

Para que tu agente escanee por ti, sin que tú escribas comandos.

**Claude Code:**

```bash
claude mcp add uui -- npx -y -p uui-scan uui-scan-mcp
```

**Cualquier cliente MCP por stdio** (`.mcp.json` de tu proyecto):

```json
{
  "mcpServers": {
    "uui": { "command": "npx", "args": ["-y", "-p", "uui-scan", "uui-scan-mcp"] }
  }
}
```

El `-p` es necesario: el ejecutable no se llama igual que el paquete.

Y luego, en lenguaje natural:

> *«Escanea https://miapp.com/facturas y dime qué campos tiene el formulario de alta»*

### Herramientas

| Herramienta | Parámetros | Qué devuelve |
|---|---|---|
| `ui.scan` | `target`, `format` (`markdown`\|`json`), `quietMs`, `filterRole`, `filterNameContains` | El catálogo de selectores |
| `ui.snapshot` | `target`, `mode` (`actionable`\|`compact`\|`full`), `root`, `maxDepth`, `filterRole`, `filterNameContains` | Árbol de UI, optimizado para tokens |
| `ui.find` | `target`, `nameContains`, `nameEquals`, `role` | Nodos que casan, con su `uid` |
| `ui.act` | `target`, `uid`, `verb`, `value` | Ejecuta `invoke`/`setValue`/`toggle`/`expand`/`select`/`focus`/`scrollIntoView` |

> ⚠️ **`ui.act` actúa sobre la app de verdad.** Las otras tres solo leen. Un agente con
> esta herramienta puede pulsar botones y enviar formularios en una aplicación en
> producción, con tu sesión iniciada. Si solo quieres que te devuelva selectores, pídele
> explícitamente que use `ui.scan` y no `ui.act`.

**Solo `ui.scan` devuelve selectores.** Las otras tres devuelven identificadores **opacos**
(`uid`) que se re-resuelven contra la pantalla en cada acción. La separación es deliberada:
un selector guardado se pudre entre renders, así que reportar y actuar son cosas distintas.
Para "¿cómo alcanzo este campo desde mi test?" usa `ui.scan`; para "haz esto por mí", el
resto.

`ui.snapshot` cuesta un orden de magnitud menos que un volcado completo: medido contra un
dashboard real, 517 tokens en modo `actionable` frente a 9.864 del árbol entero.

---

## Cómo funciona

**Encuentra los campos que el navegador no nombra.** Muchísimas apps pintan
`<div><label>Nombre*</label><input/></div>` sin vincular el label con `for`/`id`. Un lector
de pantalla no los asocia, y `getByRole` tampoco los encuentra. `uui-scan` deduce el nombre
del contenedor, acotado a un solo label y un solo control para no robarle la etiqueta al
campo vecino. Sin esto, formularios enteros salen sin nombre.

**Espera a que la pantalla se asiente.** Una SPA renderiza por etapas, y capturar a
destiempo devuelve un catálogo corto **con toda la apariencia de estar completo** — que es
peor que un error, porque no te enteras. Medido contra una app real: tres escaneos de la
misma URL daban 960, 207 y 207 nodos. Con la espera: 905, 905, 905.

**Colapsa las repeticiones, pero solo cuando puede probar que lo son.** Una tabla de 20
filas es una entrada `×20` con el índice parametrizado, no 20 rutas CSS de 200 caracteres.
Exige nombre, mismo tipo de selector, e índices en un rango contiguo — con ids de negocio
(`qty_10432`, `qty_99871`) **no** colapsa, porque `qty_{n}` sería mentira.

**Avisa de lo que no pudo clasificar.** Con el conteo por rol, arriba del documento. Un
catálogo que descarta en silencio te hace creer que viste toda la pantalla.

---

## Avanzado: utilidades del motor

No son la vía principal — existen para depurar el motor o ver crudo lo que ve el agente.

```bash
uui-scan snapshot <url> [--mode actionable|compact|full] [--depth N] [--filter-role R] [--filter-name T]
uui-scan find <url> <texto> [--role R]
uui-scan act <url> <verbo> --find <texto> [--role R] [--value V]
```

Todas aceptan además `--headed`, `--clean` y `--profile <dir>`.

<details>
<summary><strong>Avanzado: flujos y generación de código</strong> — congelado, no es la vía principal</summary>

<br>

Funciona y tiene tests, pero está **fuera del foco del producto** y no se invierte más
tiempo en ello. Se documenta porque el código se publica en el mismo binario.

Un *flujo* es un `.json` con pasos deterministas (`goto`, `waitFor`, `waitForValue`,
`waitForStable`, `act`, `expect`, `extract`) que se ejecuta sin IA y sin tokens. `codegen`
lo convierte en un script de Playwright autónomo, que ya no depende de `uui-scan`.

```bash
uui-scan run mi-flujo.flow.json
uui-scan codegen mi-flujo.flow.json --target playwright-ts --out automatizacion.ts
```

`--target` acepta `playwright-ts`, `playwright-test` y `playwright-py`.

</details>

---

## Límites conocidos

- **Solo web.** Escanear aplicaciones de escritorio (Windows UI Automation) **no está
  implementado**. El modelo de datos ya lo contempla (`automationId` ↔ `AutomationId`,
  `required` ↔ `IsRequiredForForm`, `options` ↔ `SelectionPattern`), pero el backend no
  existe. Si necesitas escanear una app de escritorio, este paquete todavía no te sirve.
- **Los selectores caducan.** Cuando la app se rediseña, un `css`/`xpath` deja de valer.
  Por eso el catálogo lleva fecha y por eso ordena por robustez.
- **Una app con animación perpetua** (un contador visible, un spinner que nunca para) agota
  el plazo de espera. Se captura igual el último estado, pero tarda más; usa `--no-wait`.
- **El target Python de `codegen`** no incluye el respaldo por label visual, así que un
  campo cuyo nombre se dedujo del contenedor no se alcanza en el script generado.

## Problemas frecuentes

| Síntoma | Causa y solución |
|---|---|
| `Executable doesn't exist` | Falta Chromium: `npx playwright install chromium` |
| El escaneo devuelve la página de login | Guarda la sesión primero con `uui-scan login <url>` |
| Cuelga o falla al abrir el navegador | El perfil admite un proceso a la vez: cierra el navegador de `login`, o usa `--clean` |
| El catálogo sale más corto de lo esperado | La SPA no había terminado. Sube `--quiet-ms 1500` |
| Login con Google/SSO que no deja entrar | El navegador ya no se anuncia como automatizado (`navigator.webdriver` = `false`). Si aun así te rechaza, usa `--headed`: en headless el User-Agent sigue diciendo "Headless" y eso no lo tapa ninguna bandera |
| Salen muchísimas filas | Acota con `--filter-role form` o `--filter-name "<región>"` |

---

MIT © Emmanuel Rios
