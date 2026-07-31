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
 * En vez de exigir que el flujo sepa de dónde salió cada nombre, el código generado prueba
 * primero lo robusto (rol + nombre accesible) y solo si no hay coincidencias cae al label
 * visual. Determinista, sin IA, y sin depender de selectores CSS del maquetado.
 */
const LOCATE_HELPER = [
  "type RoleName = Parameters<typeof page.getByRole>[0];",
  "",
  "async function locate(role: string, name?: string, exact = true): Promise<Locator> {",
  "  if (!name) return page.getByRole(role as RoleName).first();",
  "  const byRole = page.getByRole(role as RoleName, { name, exact }).first();",
  "  if ((await byRole.count()) > 0) return byRole;",
  "  // Respaldo: <label> visual no vinculado con for/id (ver ADR-0004).",
  '  const esc = name.replace(/"/g, \'\\\\"\');',
  "  const byVisualLabel = page.locator(",
  "    `xpath=//label[normalize-space(.)=\"${esc}\" or normalize-space(.)=\"${esc}*\"]` +",
  '      `/following::*[self::input or self::textarea or self::select][1]`,',
  "  );",
  "  if ((await byVisualLabel.count()) > 0) return byVisualLabel.first();",
  "  return byRole; // deja que falle con el mensaje de Playwright, que es más informativo",
  "}",
  "",
  "async function locateText(text: string, exact = true): Promise<Locator> {",
  "  return page.getByText(text, { exact }).first();",
  "}",
  "",
];

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
    return `await locate(${quoteJs(f.role)}, ${quoteJs(nombre)}, ${String(Boolean(f.nameEquals))})`;
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

  if (options.asTest) {
    return [
      ...cabecera,
      'import { test, expect } from "@playwright/test";',
      "",
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
    "try {",
    ...flow.steps.flatMap((step, index) => stepCodeStandalone(step, index)),
    "  console.log(JSON.stringify(datos, null, 2));",
    "} finally {",
    "  await context.close();",
    "}",
    "",
  ].join("\n");
}
