import type { Flow, FlowStep, Predicate } from "@uui/core";
import { describePredicate, flatten, quoteJs } from "./predicateText.js";

/**
 * Genera un script de Playwright (TypeScript) autónomo: NO importa `@uui/*` ni necesita
 * una IA para correr. Ese es el objetivo del proyecto — la IA hace el trabajo caro de
 * descubrimiento UNA vez, y lo que queda es código normal, revisable en un PR y
 * ejecutable mil veces por cero tokens.
 *
 * La traducción es casi 1:1 porque el Modelo Universal (rol ARIA + nombre accesible) y
 * `getByRole(role, { name })` de Playwright hablan el mismo idioma. Esa coincidencia no
 * es casual: es la razón por la que D3 fijó el vocabulario ARIA como enum canónico.
 */

function locator(predicate: Predicate): string {
  const f = flatten(predicate);
  if (f.role) {
    const opciones: string[] = [];
    if (f.nameEquals) opciones.push(`name: ${quoteJs(f.nameEquals)}, exact: true`);
    else if (f.nameContains) opciones.push(`name: ${quoteJs(f.nameContains)}`);
    return opciones.length > 0
      ? `page.getByRole(${quoteJs(f.role)}, { ${opciones.join(", ")} })`
      : `page.getByRole(${quoteJs(f.role)})`;
  }
  if (f.nameEquals) return `page.getByText(${quoteJs(f.nameEquals)}, { exact: true })`;
  return `page.getByText(${quoteJs(f.nameContains ?? "")})`;
}

/** Primer elemento: los flujos actúan sobre la primera coincidencia (misma semántica que
 * `runFlow`), y Playwright exige desambiguar cuando hay varias. */
function first(predicate: Predicate): string {
  return `${locator(predicate)}.first()`;
}

/**
 * Aserciones para el script AUTÓNOMO. El target `playwright-test` usa `expect` de
 * `@playwright/test`; el script suelto no puede, porque ese paquete es el runner de
 * pruebas y exigirlo convertiría "un script que corre con node" en "un proyecto de
 * testing". Estas equivalencias usan solo la API de `playwright` y lanzan al fallar, que
 * es lo que un proceso automatizado necesita para terminar con código de salida ≠ 0.
 */
/**
 * Localizador con RESPALDO — cierra la divergencia documentada en ADR-0004.
 *
 * `getByRole(role, {name})` usa el árbol de accesibilidad REAL del navegador. Pero muchas
 * apps pintan `<div><label>Nombre*</label><input/></div>` sin vincular el label con
 * `for`/`id`: el motor de uui deduce ese nombre a propósito (si no, formularios enteros
 * serían inalcanzables), y el navegador no. Resultado: `uui run` encuentra el campo y el
 * `getByRole` generado no.
 *
 * El respaldo replica la regla del motor (`backend-web/src/pageScript.ts`), **incluida su
 * guarda de unicidad**: un contenedor vale como etiqueta solo si tiene UN label y UN
 * control. La primera versión usaba `//label[...]/following::input[1]`, que no tiene esa
 * guarda: el eje `following` recorre el documento entero, así que si un label no va
 * seguido de su propio control, se lleva el del campo SIGUIENTE — silenciosamente y con
 * el nombre equivocado. (En la app donde se probó, ambas expresiones coinciden; esto
 * cierra una divergencia con el motor, no arregla un fallo observado allí. Ver el test
 * `divergencia` para un DOM donde sí difieren.)
 *
 * Se añade además el respaldo por `placeholder`, que es la última regla de nombres del
 * motor: sin él, un campo cuyo nombre viene del placeholder es inalcanzable en el script
 * generado aunque `uui run` lo encuentre.
 *
 * La elección entre estrategias es PEREZOSA: decidir con `count()` sobre un DOM a medio
 * renderizar congela la rama equivocada para siempre, porque el `Locator` devuelto ya no
 * vuelve a evaluarla. Se espera a que aparezca cualquiera y solo entonces se decide,
 * respetando el orden de prioridad del motor (rol/nombre accesible → label → placeholder).
 */
/**
 * Roles que el motor asigna a `input`/`textarea`/`select` (ver el mapa tag→rol en
 * `backend-web/src/pageScript.ts`). Solo para estos deduce el nombre a partir del label
 * del contenedor o del placeholder, así que solo para estos tiene sentido el respaldo.
 */
const ROLES_CON_RESPALDO = new Set<string>([
  "textbox",
  "searchbox",
  "combobox",
  "spinbutton",
  "checkbox",
  "radio",
  "slider",
]);

/**
 * Literal XPath seguro. XPath 1.0 NO tiene escapes dentro de una cadena: `\"` no
 * significa nada ahí. Un nombre con comillas dobles hay que partirlo con `concat()`.
 */
export function xpathLiteral(s: string): string {
  if (!s.includes('"')) return `"${s}"`;
  if (!s.includes("'")) return `'${s}'`;
  return `concat(${s
    .split('"')
    .map((p) => `"${p}"`)
    .join(`, '"', `)})`;
}

/**
 * XPath para labels visuales no vinculados. El nombre se conoce en tiempo de GENERACIÓN,
 * así que se emite ya calculado: la regla vive una sola vez (aquí, testeable) en vez de
 * duplicada dentro del texto generado, y queda a la vista en el script para quien lo
 * revise en un PR.
 *
 * Replica la guarda de UNICIDAD del motor (un label y un control en el contenedor), pero
 * NO su límite de 3 ancestros: XPath 1.0 no tiene forma razonable de acotar la
 * profundidad, así que este selector es más permisivo. Medido: con el label a 5
 * ancestros el motor devuelve `null` y este XPath sí encuentra el control.
 *
 * Es aceptable porque el respaldo solo se USA cuando `getByRole` no encontró nada, y el
 * nombre que se busca lo dedujo el propio motor: si el motor no le puso nombre al campo,
 * ningún flujo puede referirse a él por ese nombre. Ser más permisivo aquí amplía lo que
 * el script generado alcanza, no lo que confunde.
 */
export function xpathLabelVisual(name: string): string {
  const eq = (t: string) => `normalize-space(.//label)=${xpathLiteral(t)}`;
  return (
    `xpath=//*[count(.//label)=1 and count(.//input|.//textarea|.//select)=1` +
    ` and (${eq(name)} or ${eq(`${name}*`)})]` +
    `//*[self::input or self::textarea or self::select]`
  );
}

const LOCATE_HELPER = `
type RoleName = Parameters<typeof page.getByRole>[0];

async function locate(
  role: string,
  name?: string,
  exact = true,
  xpathLabel?: string,
): Promise<Locator> {
  if (!name) return page.getByRole(role as RoleName).first();
  const byRole = page.getByRole(role as RoleName, { name, exact });
  // Los respaldos son reglas de nombre de CONTROLES de formulario (input/textarea/select).
  // El generador solo pasa xpathLabel para roles de control: aplicarlos a un "button"
  // resolvería a un campo de texto con ese nombre.
  if (!xpathLabel) return byRole.first();
  const byLabel = page.locator(xpathLabel);
  const byPlaceholder = page.getByPlaceholder(name, { exact });
  // Espera a que exista ALGUNA antes de decidir: decidir con count() sobre un DOM a
  // medio renderizar congela la rama equivocada y el locator devuelto ya no re-evalúa.
  await byRole.or(byLabel).or(byPlaceholder).first().waitFor({ state: "attached" }).catch(() => {});
  if ((await byRole.count()) > 0) return byRole.first();
  if ((await byLabel.count()) > 0) return byLabel.first();
  if ((await byPlaceholder.count()) > 0) return byPlaceholder.first();
  return byRole.first(); // deja que falle con el mensaje de Playwright, que es más informativo
}

async function locateText(text: string, exact = true): Promise<Locator> {
  return page.getByText(text, { exact }).first();
}
`
  .trimStart()
  .split("\n");

/**
 * Traducción de `waitForStable` (ADR-0005) al código generado.
 *
 * En el script no existe el árbol universal, así que la misma semántica —"nada cambió
 * durante `quietMs` seguidos"— se mide con un `MutationObserver` sobre el DOM. Es la
 * espera que necesita una SPA que renderiza en varias etapas: `waitFor` se cumple en la
 * primera y actuar ahí deja el formulario a medio inicializar.
 *
 * `pageParam` distingue los dos targets: el script suelto tiene `page` en el módulo; el
 * de `@playwright/test` la recibe como fixture.
 */
function waitForStableHelper(pageParam: boolean): string[] {
  const firma = pageParam
    ? "async function waitForStable(page: Page, quietMs: number, timeoutMs: number): Promise<void> {"
    : "async function waitForStable(quietMs: number, timeoutMs: number): Promise<void> {";
  return [
    firma,
    "  await page.evaluate(",
    "    ([quiet, limite]) =>",
    "      new Promise<void>((resolve, reject) => {",
    "        let timer: ReturnType<typeof setTimeout> | undefined;",
    "        let vencimiento: ReturnType<typeof setTimeout> | undefined;",
    "        function listo() {",
    "          observer.disconnect();",
    "          clearTimeout(timer);",
    "          clearTimeout(vencimiento);",
    "          resolve();",
    "        }",
    "        const observer = new MutationObserver(() => {",
    "          clearTimeout(timer);",
    "          timer = setTimeout(listo, quiet);",
    "        });",
    "        vencimiento = setTimeout(() => {",
    "          observer.disconnect();",
    "          clearTimeout(timer);",
    "          reject(",
    "            new Error(",
    "              `El DOM siguió cambiando durante ${limite}ms sin quedarse quieto ${quiet}ms seguidos.`,",
    "            ),",
    "          );",
    "        }, limite);",
    "        observer.observe(document, {",
    "          childList: true,",
    "          subtree: true,",
    "          attributes: true,",
    "          characterData: true,",
    "        });",
    "        timer = setTimeout(listo, quiet);",
    "      }),",
    "    [quietMs, timeoutMs] as const,",
    "  );",
    "}",
    "",
  ];
}

const STANDALONE_HELPERS = [
  "async function assertVisible(locator: Locator, desc: string): Promise<void> {",
  "  try {",
  '    await locator.waitFor({ state: "visible" });',
  "  } catch {",
  "    throw new Error(`Se esperaba que existiera y fuera visible: ${desc}`);",
  "  }",
  "}",
  "",
  "async function assertCount(locator: Locator, expected: number, desc: string): Promise<void> {",
  "  const actual = await locator.count();",
  "  if (actual !== expected) {",
  "    throw new Error(`Se esperaban ${expected} coincidencias de ${desc} y hubo ${actual}.`);",
  "  }",
  "}",
  "",
  "async function assertText(",
  "  locator: Locator,",
  "  expected: string,",
  "  mode: \"equals\" | \"contains\",",
  "  desc: string,",
  "): Promise<void> {",
  '  const actual = ((await locator.textContent()) ?? "").trim();',
  '  const ok = mode === "equals" ? actual === expected : actual.includes(expected);',
  "  if (!ok) {",
  "    throw new Error(`${desc}: se esperaba ${mode === \"equals\" ? \"\" : \"que contuviera \"}\"${expected}\" y era \"${actual}\".`);",
  "  }",
  "}",
  "",
  "async function assertValueNotEmpty(locator: Locator, timeoutMs: number, desc: string): Promise<void> {",
  "  const deadline = Date.now() + timeoutMs;",
  "  for (;;) {",
  "    const value = (await locator.inputValue()).trim();",
  "    if (value.length > 0) return;",
  "    if (Date.now() >= deadline) throw new Error(`El campo siguió vacío: ${desc}`);",
  "    await new Promise((r) => setTimeout(r, 300));",
  "  }",
  "}",
  "",
];

/** Expresión que resuelve el objetivo de un paso usando el helper `locate` con respaldo. */
function locateCall(predicate: Predicate): string {
  const f = flatten(predicate);
  if (f.role) {
    const nombre = f.nameEquals ?? f.nameContains;
    if (nombre === undefined) return `await locate(${quoteJs(f.role)})`;
    // El respaldo solo aplica a coincidencia EXACTA (la regla del motor compara el texto
    // completo del label, no una subcadena) y solo a roles de CONTROL de formulario, que
    // es donde el motor deduce el nombre a partir del label o del placeholder.
    const aplica = Boolean(f.nameEquals) && ROLES_CON_RESPALDO.has(f.role);
    const respaldo = aplica ? `, ${quoteJs(xpathLabelVisual(nombre))}` : "";
    return `await locate(${quoteJs(f.role)}, ${quoteJs(nombre)}, ${String(Boolean(f.nameEquals))}${respaldo})`;
  }
  const texto = f.nameEquals ?? f.nameContains ?? "";
  return `await locateText(${quoteJs(texto)}, ${String(Boolean(f.nameEquals))})`;
}

/** Igual que `stepCode` pero sin `@playwright/test` y usando `locate` (con respaldo). */
function stepCodeStandalone(step: FlowStep, index: number): string[] {
  const comentario = `  // ${step.label ?? step.action}`;
  if (step.action === "goto") {
    return [comentario, `  await page.goto(${quoteJs(step.target)});`];
  }
  if (step.action === "waitForStable") {
    return [
      `${comentario} — espera a que el DOM deje de cambiar (ADR-0005)`,
      `  await waitForStable(${step.quietMs ?? 500}, ${step.timeoutMs ?? 15000});`,
    ];
  }

  const objetivo = `el${index}`;
  const resolver = `  const ${objetivo} = ${locateCall(step.target)};`;
  const desc = quoteJs(describePredicate(step.target));

  switch (step.action) {
    case "waitFor":
      return [
        `${comentario} — espera por condición, no por tiempo fijo`,
        resolver,
        `  await assertVisible(${objetivo}, ${desc});`,
      ];

    case "waitForValue":
      return [
        `${comentario} — espera a que el campo derivado termine de calcularse`,
        resolver,
        `  await assertValueNotEmpty(${objetivo}, ${step.timeoutMs ?? 15000}, ${desc});`,
      ];

    case "act":
      switch (step.verb) {
        case "invoke":
        case "toggle":
        case "expand":
          return [comentario, resolver, `  await ${objetivo}.click();`];
        case "setValue":
          return [comentario, resolver, `  await ${objetivo}.fill(${quoteJs(step.value ?? "")});`];
        case "select":
          return [
            comentario,
            resolver,
            step.value !== undefined
              ? `  await ${objetivo}.selectOption(${quoteJs(step.value)});`
              : `  await ${objetivo}.click();`,
          ];
        case "focus":
          return [comentario, resolver, `  await ${objetivo}.focus();`];
        case "scrollIntoView":
          return [comentario, resolver, `  await ${objetivo}.scrollIntoViewIfNeeded();`];
      }
      break;

    case "expect":
      switch (step.assert) {
        case "exists":
          return [comentario, resolver, `  await assertVisible(${objetivo}, ${desc});`];
        case "notExists":
          return [comentario, `  await assertCount(${locator(step.target)}, 0, ${desc});`];
        case "count":
          return [comentario, `  await assertCount(${locator(step.target)}, ${step.count ?? 0}, ${desc});`];
        case "nameEquals":
          return [
            comentario,
            resolver,
            `  await assertText(${objetivo}, ${quoteJs(step.value ?? "")}, "equals", ${desc});`,
          ];
        case "nameContains":
          return [
            comentario,
            resolver,
            `  await assertText(${objetivo}, ${quoteJs(step.value ?? "")}, "contains", ${desc});`,
          ];
      }
      break;

    case "extract":
      return [
        comentario,
        resolver,
        `  datos[${quoteJs(step.name)}] = (await ${objetivo}.${
          step.field === "value" ? "inputValue()" : "textContent()"
        }) ?? null;`,
      ];
  }
  return [comentario, "  // (paso no soportado por este generador)"];
}

function stepCode(step: FlowStep): string[] {
  const comentario = `  // ${step.label ?? step.action}`;
  switch (step.action) {
    case "goto":
      return [comentario, `  await page.goto(${quoteJs(step.target)});`];

    case "waitForStable":
      return [
        `${comentario} — espera a que el DOM deje de cambiar (ADR-0005)`,
        `  await waitForStable(page, ${step.quietMs ?? 500}, ${step.timeoutMs ?? 15000});`,
      ];

    case "waitFor":
      return [
        `${comentario} — espera por condición, no por tiempo fijo`,
        `  await ${first(step.target)}.waitFor({ state: "visible"${
          step.timeoutMs ? `, timeout: ${step.timeoutMs}` : ""
        } });`,
      ];

    case "waitForValue":
      return [
        `${comentario} — espera a que el campo derivado termine de calcularse`,
        step.expect === "equals"
          ? `  await expect(${first(step.target)}).toHaveValue(${quoteJs(step.value ?? "")}${
              step.timeoutMs ? `, { timeout: ${step.timeoutMs} }` : ""
            });`
          : `  await expect(${first(step.target)}).not.toHaveValue(""${
              step.timeoutMs ? `, { timeout: ${step.timeoutMs} }` : ""
            });`,
      ];

    case "act": {
      const target = first(step.target);
      switch (step.verb) {
        case "invoke":
          return [comentario, `  await ${target}.click();`];
        case "setValue":
          return [comentario, `  await ${target}.fill(${quoteJs(step.value ?? "")});`];
        case "toggle":
          return [comentario, `  await ${target}.click();`];
        case "expand":
          return [comentario, `  await ${target}.click();`];
        case "select":
          return [
            comentario,
            step.value !== undefined
              ? `  await ${target}.selectOption(${quoteJs(step.value)});`
              : `  await ${target}.click();`,
          ];
        case "focus":
          return [comentario, `  await ${target}.focus();`];
        case "scrollIntoView":
          return [comentario, `  await ${target}.scrollIntoViewIfNeeded();`];
      }
      break;
    }

    case "expect": {
      const desc = quoteJs(describePredicate(step.target));
      switch (step.assert) {
        case "exists":
          return [comentario, `  await expect(${first(step.target)}, ${desc}).toBeVisible();`];
        case "notExists":
          return [comentario, `  await expect(${locator(step.target)}, ${desc}).toHaveCount(0);`];
        case "count":
          return [
            comentario,
            `  await expect(${locator(step.target)}, ${desc}).toHaveCount(${step.count ?? 0});`,
          ];
        case "nameEquals":
          return [
            comentario,
            `  await expect(${first(step.target)}, ${desc}).toHaveText(${quoteJs(step.value ?? "")});`,
          ];
        case "nameContains":
          return [
            comentario,
            `  await expect(${first(step.target)}, ${desc}).toContainText(${quoteJs(step.value ?? "")});`,
          ];
      }
      break;
    }

    case "extract":
      return [
        comentario,
        `  datos[${quoteJs(step.name)}] = (await ${first(step.target)}.${
          step.field === "value" ? "inputValue()" : "textContent()"
        }) ?? null;`,
      ];
  }
  return [comentario, "  // (paso no soportado por este generador)"];
}

export type PlaywrightOptions = {
  /** Emite un test de Playwright (`test(...)`) en vez de un script ejecutable con `node`. */
  asTest?: boolean;
  headless?: boolean;
};

export function generatePlaywrightTs(flow: Flow, options: PlaywrightOptions = {}): string {
  const cuerpo = flow.steps.flatMap(stepCode);
  const cabecera = [
    "// Generado por `uui codegen` a partir de un flujo de Universal UI Engine.",
    `// Flujo: ${flow.name}${flow.description ? ` — ${flow.description}` : ""}`,
    "//",
    "// Este script es AUTÓNOMO: no importa @uui/* ni necesita una IA para ejecutarse.",
    "// Localiza por rol + nombre accesible, no por selectores CSS frágiles, así que",
    "// sobrevive a los rediseños que rompen los scripts grabados a la vieja usanza.",
    "",
  ];

  // El helper solo se emite si el flujo lo usa: un script generado no debe llevar código
  // muerto que quien lo revise tenga que descartar.
  const usaEstabilidad = flow.steps.some((step) => step.action === "waitForStable");

  if (options.asTest) {
    return [
      ...cabecera,
      usaEstabilidad
        ? 'import { test, expect, type Page } from "@playwright/test";'
        : 'import { test, expect } from "@playwright/test";',
      "",
      ...(usaEstabilidad ? waitForStableHelper(true) : []),
      `test(${quoteJs(flow.name)}, async ({ page }) => {`,
      "  const datos: Record<string, string | null> = {};",
      ...cuerpo,
      "  console.log(JSON.stringify(datos, null, 2));",
      "});",
      "",
    ].join("\n");
  }

  return [
    ...cabecera,
    "// Requiere solo `playwright` (no `@playwright/test`): es un script, no una suite.",
    'import { homedir } from "node:os";',
    'import { join } from "node:path";',
    'import { chromium, type Locator } from "playwright";',
    "",
    "// Sesión: el script reutiliza el MISMO perfil persistente con el que se descubrió el",
    "// flujo (`uui login`), así que una app que exige autenticación funciona sin volver a",
    "// iniciar sesión. Con UUI_PROFILE se apunta a otro perfil — p. ej. uno por cliente o",
    "// uno dedicado en el servidor de automatización.",
    'const profileDir = process.env.UUI_PROFILE ?? join(homedir(), ".uui", "profile");',
    "",
    "const context = await chromium.launchPersistentContext(profileDir, { headless: " +
      String(options.headless ?? true) +
      " });",
    "const page = context.pages()[0] ?? (await context.newPage());",
    "const datos: Record<string, string | null> = {};",
    "",
    ...LOCATE_HELPER,
    ...STANDALONE_HELPERS,
    ...(usaEstabilidad ? waitForStableHelper(false) : []),
    "try {",
    ...flow.steps.flatMap((step, index) => stepCodeStandalone(step, index)),
    "  console.log(JSON.stringify(datos, null, 2));",
    "} finally {",
    "  await context.close();",
    "}",
    "",
  ].join("\n");
}
