# ADR-0004: Flujos y generación de código (F3)

- **Estado:** Aceptado, con una limitación conocida y medida (ver §"Divergencia de nombres")
- **Contexto de origen:** primer proceso real automatizado de punta a punta

## Contexto

El objetivo del proyecto no es "una IA que hace clics", es **una IA que escribe
automatizaciones**. El ciclo previsto:

```
La IA explora la app UNA vez con `uui find`   (caro: tokens, minutos)
        ↓
Emite un FLUJO declarativo                     (artefacto versionable)
        ↓
`uui run` lo ejecuta sin IA                    (segundos, cero tokens)
        ↓
`uui codegen` emite código autónomo            (sin uui, sin IA, en CI)
```

Hasta F0 solo existía el primer paso, y por eso el motor no se distinguía de un agente con
acceso a un navegador — crítica legítima que originó este trabajo.

## Decisiones

### D12 — `Flow`: un programa declarativo, no una grabación de clics

Un flujo es una lista de pasos que localizan por PREDICADO determinista (D7), nunca por
coordenadas. Tipos de paso: `goto`, `waitFor`, `waitForValue`, `act`, `expect`, `extract`.

Es texto plano revisable en un PR: se ve qué se va a hacer *antes* de ejecutarlo, a
diferencia de un agente al que solo se le puede auditar después.

### D13 — Esperas por condición, nunca por tiempo

`waitFor` (existencia) y `waitForValue` (valor de un campo) reintentan hasta cumplir o
agotar plazo. Nada de `sleep` fijos.

`waitForValue` nació de un fallo real: al crear un ítem en un SaaS de facturación, la app
autocompleta "Unidad de medida" y recalcula "Precio Total" de forma asíncrona; guardar
300 ms después enviaba el formulario incompleto. Un `sleep` habría tapado el síntoma y
producido una automatización intermitente — que es la peor clase de automatización.

### D14 — Un flujo se DETIENE en el primer paso fallido

Una automatización que sigue tras un error hace daño en vez de trabajo. `expect` es lo que
la convierte en confiable: sin validaciones, un flujo "termina bien" habiendo hecho nada.
En la primera ejecución real, `expect exists` detectó que el ítem no se había creado
aunque todos los pasos previos reportaban OK.

### D15 — `Backend.navigate()` opcional en el contrato

Un flujo casi siempre empieza con "ve a X". Es opcional porque no toda tecnología tiene el
concepto: Web es `page.goto`; UIA (F2) sería lanzar/enfocar una app; SAP, abrir una
transacción. Un backend que no lo implemente simplemente no admite pasos `goto`.

### D16 — El código generado es autónomo, y hereda la sesión

`uui codegen` emite Playwright TS (script o test) y Python. El script **no importa
`@uui/*` ni `@playwright/test`** — solo `playwright` — porque exigir el runner de pruebas
convertiría "un script que corre con node" en "un proyecto de testing". Las aserciones se
generan como helpers que lanzan al fallar (código de salida ≠ 0, que es lo que un
orquestador necesita).

El script reutiliza el **perfil persistente** (`~/.uui/profile`, o `UUI_PROFILE`) con el
que se descubrió el flujo, así que una app autenticada funciona sin volver a iniciar
sesión. Verificado: el script generado, ejecutado con `node --experimental-strip-types`,
entra a la app con la sesión real.

## Resultados medidos (proceso real: crear un ítem de venta en Alegra)

| | Antes (IA en el bucle) | `uui run` (flujo) |
|---|---|---|
| Tiempo | ~1 min + 4 intentos | **8,6 s** |
| Tokens | miles | **0** |
| Reproducible | no | sí |
| Validado | no | 2 aserciones + 1 extracción |

## Divergencia de nombres: la limitación conocida

**El código generado para Playwright asume que el nombre accesible del Modelo Universal
coincide con el que calcula el navegador.** Eso es cierto casi siempre — y no por
casualidad: D3 fijó el vocabulario ARIA precisamente para que `getByRole(role, {name})`
fuera una traducción 1:1.

Pero deja de serlo donde el motor extiende la especificación a propósito: para alcanzar
formularios cuyos `<label>` no están vinculados con `for`/`id` (defecto de accesibilidad
frecuentísimo en apps reales), `backend-web` deduce el nombre del label visual del
contenedor. El motor entonces SÍ encuentra el campo… y el `getByRole` generado NO, porque
el árbol de accesibilidad real del navegador tampoco asocia ese label.

Verificado contra la app real: `uui run` completa el flujo; el script generado falla
esperando `getByRole("textbox", { name: "Nombre" })`.

**Opciones para cerrarlo (F3 continuación), en orden de preferencia:**

1. Que cada nodo declare **de dónde salió su nombre** (`from: "label" | "aria-label" |
   "content" | "visual-label"`), y que `codegen` emita un localizador distinto cuando no
   sea estándar — p. ej. anclar por el texto del label y bajar al control del contenedor.
2. Emitir el locator concreto que el resolver ya usó (css/xpath) como respaldo del
   `getByRole`, aceptando que es más frágil pero verificable.
3. Restringir la deducción de label visual a `uui run` (que sí la sabe usar) y que
   `codegen` avise cuando un paso no es traducible.

La opción 1 es la correcta: preserva la robustez del nombre accesible y hace explícito el
único caso donde el modelo y el navegador discrepan. Requiere un campo nuevo en `UINode`,
así que será un ADR propio.
