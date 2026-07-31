import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { Session } from "@uui/core";
import { WebBackend } from "../src/index.js";

/**
 * Los locators "estables" (testId, id, name) solo valen si identifican a UN elemento.
 * En una app real, un `data-testid` repetido por fila de tabla es lo normal, y un `id`
 * duplicado no es raro. Emitir esos locators haría dos daños: `resolveLocator` exige una
 * coincidencia única, así que nunca resolverían al actuar; y el catálogo (ADR-0006)
 * recomendaría al desarrollador un selector que casa con varios elementos.
 *
 * Se usa `setContent` en vez de tocar `fixtures/web-app`: esa app la comparten los golden
 * trees y el gate de tokens, y meterle duplicados a propósito los movería sin motivo.
 */

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
});

afterAll(async () => {
  await browser.close();
});

/**
 * Tipos de locator que el catálogo ofrece para el campo llamado `nombre`.
 *
 * Se pasa por `session.catalog()` a propósito: es la ÚNICA superficie que expone
 * locators (ADR-0006). Un intento previo de este helper usaba `session.find()` y salían
 * listas vacías — porque `find()` los strippea por D1. El fallo del test fue, de hecho,
 * la mejor prueba de que esa opacidad funciona.
 */
async function kindsDe(html: string, nombre: string): Promise<string[]> {
  await page.setContent(html);
  const session = new Session(WebBackend.fromPage(page));
  const catalogo = await session.catalog({
    target: "test",
    scannedAt: "2026-01-01T00:00:00.000Z",
    // `setContent` ya devolvió con el DOM puesto: no hay nada que esperar.
    stabilize: false,
  });

  const entradas = catalogo.groups.flatMap((grupo) => [...grupo.fields, ...grupo.actions]);
  // El nombre deducido del label puede traer el asterisco de obligatorio.
  const entrada = entradas.find((e) => (e.name ?? "").replace(/\*$/, "") === nombre);
  if (!entrada) {
    throw new Error(
      `No se encontró "${nombre}" en el catálogo. Había: ${entradas.map((e) => e.name).join(", ")}`,
    );
  }
  return [entrada.selector, ...entrada.fallbacks].filter(Boolean).map((s) => s!.kind);
}

describe("guarda de unicidad de los locators estables", () => {
  it("emite testId/id/name cuando son únicos", async () => {
    const kinds = await kindsDe(
      `<form><label>Correo</label>
       <input data-testid="email" id="email" name="email"></form>`,
      "Correo",
    );

    expect(kinds).toContain("testId");
    expect(kinds).toContain("automationId");
    expect(kinds).toContain("attrName");
  });

  it("NO emite un data-testid repetido: nunca resolvería y engañaría en el catálogo", async () => {
    const kinds = await kindsDe(
      `<form><label>Correo</label><input data-testid="campo"></form>
       <form><label>Otro</label><input data-testid="campo"></form>`,
      "Correo",
    );

    expect(kinds).not.toContain("testId");
    // Sigue habiendo por dónde agarrarlo, solo que menos estable.
    expect(kinds).toContain("css");
  });

  it("NO emite un id duplicado, aunque el HTML lo permita en la práctica", async () => {
    const kinds = await kindsDe(
      `<form><label>Correo</label><input id="repetido"></form>
       <form><label>Otro</label><input id="repetido"></form>`,
      "Correo",
    );

    expect(kinds).not.toContain("automationId");
    // Control positivo: sin esto, un `kinds` vacío (helper roto) aprobaría el test.
    expect(kinds).toContain("css");
  });

  it("NO emite un atributo name compartido — el caso normal de los radio buttons", async () => {
    const kinds = await kindsDe(
      `<form><label>Plan</label><input type="radio" name="plan" value="a"></form>
       <form><label>Otro</label><input type="radio" name="plan" value="b"></form>`,
      "Plan",
    );

    expect(kinds).not.toContain("attrName");
    expect(kinds).toContain("css");
  });
});
