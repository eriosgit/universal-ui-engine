import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import type { Flow } from "@uui/core";
import { generatePlaywrightPy } from "../src/playwrightPy.js";
import { generatePlaywrightTs, xpathLabelVisual, xpathLiteral } from "../src/playwrightTs.js";

/**
 * Primeros tests de `@uui/codegen`. El paquete se escribió sin ninguno, y por eso el
 * respaldo de localización se descubrió divergente del motor solo corriendo un script
 * generado contra una app real.
 *
 * Lo que se prueba aquí es la propiedad que importa: el XPath de respaldo que emite el
 * generador selecciona EL MISMO elemento que la regla de nombres del motor
 * (`backend-web/src/pageScript.ts`: contenedor con un único label y un único control).
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

/** El XPath ANTERIOR, sin guarda de unicidad. Se conserva solo para contrastar. */
function xpathFollowing(name: string): string {
  return (
    `xpath=//label[normalize-space(.)="${name}" or normalize-space(.)="${name}*"]` +
    `/following::*[self::input or self::textarea or self::select][1]`
  );
}

describe("xpathLiteral", () => {
  it("entrecomilla lo normal con comillas dobles", () => {
    expect(xpathLiteral("Nombre")).toBe('"Nombre"');
  });

  it("usa comillas simples cuando el texto trae dobles", () => {
    expect(xpathLiteral('Talla "M"')).toBe(`'Talla "M"'`);
  });

  it("parte con concat() cuando el texto trae ambas comillas", () => {
    // XPath 1.0 no tiene escapes dentro de una cadena: `\"` habría dado un XPath inválido.
    expect(xpathLiteral(`d"a's`)).toBe(`concat("d", '"', "a's")`);
  });
});

describe("xpathLabelVisual — equivale a la regla del motor", () => {
  it("encuentra el campo cuyo label no está vinculado con for/id", async () => {
    await page.setContent(`
      <div class="campo"><label>Nombre*</label><input id="nombre"></div>
      <div class="campo"><label>Precio base*</label><input id="precio"></div>
    `);
    const nombre = page.locator(xpathLabelVisual("Nombre"));
    await expect.poll(() => nombre.count()).toBe(1);
    expect(await nombre.getAttribute("id")).toBe("nombre");
  });

  it("tolera el asterisco de campo obligatorio que la app pinta en el label", async () => {
    await page.setContent(`<div><label>Unidad de medida*</label><input id="unidad"></div>`);
    expect(await page.locator(xpathLabelVisual("Unidad de medida")).getAttribute("id")).toBe(
      "unidad",
    );
  });

  it("no se lleva el control de un campo vecino cuando el contenedor tiene varios", async () => {
    // La guarda de unicidad del motor: dos controles bajo el mismo label ⇒ no se deduce.
    await page.setContent(`
      <div><label>Rango</label><input id="desde"><input id="hasta"></div>
    `);
    expect(await page.locator(xpathLabelVisual("Rango")).count()).toBe(0);
  });

  it("divergencia: `following::` toma el campo SIGUIENTE si el label no tiene control propio", async () => {
    // Caso real de SPA: el control de un campo aún no se ha renderizado. El eje
    // `following` no está acotado y se lleva el input del campo de al lado — con el
    // nombre equivocado y sin ningún error. La regla del motor prefiere no encontrar nada.
    await page.setContent(`
      <div><label>Cantidad</label></div>
      <div><label>Precio</label><input id="precio"></div>
    `);
    expect(await page.locator(xpathFollowing("Cantidad")).getAttribute("id")).toBe("precio");
    expect(await page.locator(xpathLabelVisual("Cantidad")).count()).toBe(0);
  });

  it("escapa nombres con comillas sin producir un XPath inválido", async () => {
    await page.setContent(`<div><label>Talla "M"</label><input id="talla"></div>`);
    expect(await page.locator(xpathLabelVisual('Talla "M"')).getAttribute("id")).toBe("talla");
  });
});

describe("generatePlaywrightTs", () => {
  const flujo: Flow = {
    name: "demo",
    steps: [
      {
        action: "act",
        target: {
          kind: "and",
          all: [
            { kind: "role", role: "textbox" },
            { kind: "nameEquals", text: "Nombre" },
          ],
        },
        verb: "setValue",
        value: "x",
      },
    ],
  };

  it("emite el XPath de respaldo ya calculado, no el eje `following`", () => {
    const codigo = generatePlaywrightTs(flujo);
    expect(codigo).toContain("count(.//label)=1");
    expect(codigo).not.toContain("following::");
  });

  it("decide la estrategia solo después de que algo exista en el DOM", () => {
    // Si se decidiera con count() sobre un DOM a medio renderizar, la rama quedaría
    // congelada en un locator que nunca encuentra nada.
    expect(generatePlaywrightTs(flujo)).toContain('waitFor({ state: "attached" })');
  });

  it("incluye el respaldo por placeholder, última regla de nombres del motor", () => {
    expect(generatePlaywrightTs(flujo)).toContain("getByPlaceholder");
  });

  it("no pasa el respaldo para roles que no son controles de formulario", () => {
    // El XPath solo selecciona input/textarea/select: aplicarlo a un "button" haría que
    // un botón resolviera a un campo de texto con el mismo nombre.
    const conBoton: Flow = {
      name: "demo",
      steps: [
        {
          action: "act",
          target: {
            kind: "and",
            all: [
              { kind: "role", role: "button" },
              { kind: "nameEquals", text: "Guardar" },
            ],
          },
          verb: "invoke",
        },
      ],
    };
    expect(generatePlaywrightTs(conBoton)).toContain('await locate("button", "Guardar", true)');
  });
});

/** ADR-0005: el paso existe en el DSL, así que los tres targets deben traducirlo. */
describe("waitForStable en el código generado", () => {
  const conEspera: Flow = {
    name: "demo",
    steps: [
      { action: "waitForStable", quietMs: 700, timeoutMs: 9000, label: "Esperar render" },
    ],
  };

  it("el script suelto emite el helper y lo llama con la ventana declarada", () => {
    const codigo = generatePlaywrightTs(conEspera);
    expect(codigo).toContain("new MutationObserver");
    expect(codigo).toContain("await waitForStable(700, 9000);");
  });

  it("el target de @playwright/test recibe `page` como parámetro", () => {
    const codigo = generatePlaywrightTs(conEspera, { asTest: true });
    expect(codigo).toContain("async function waitForStable(page: Page,");
    expect(codigo).toContain("await waitForStable(page, 700, 9000);");
    expect(codigo).toContain("type Page");
  });

  it("el target Python emite su propio helper", () => {
    const codigo = generatePlaywrightPy(conEspera);
    expect(codigo).toContain("def wait_for_stable(page, quiet_ms, timeout_ms):");
    expect(codigo).toContain("wait_for_stable(page, 700, 9000)");
  });

  it("no emite el helper si el flujo no usa el paso: nada de código muerto", () => {
    const sinEspera: Flow = {
      name: "demo",
      steps: [{ action: "goto", target: "https://ejemplo.com" }],
    };
    expect(generatePlaywrightTs(sinEspera)).not.toContain("MutationObserver");
    expect(generatePlaywrightPy(sinEspera)).not.toContain("wait_for_stable");
  });
});
