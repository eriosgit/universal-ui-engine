import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { defineConformanceSuite, type ConformanceFixture } from "@uui/core/conformance";
import { Session } from "@uui/core";
import { WebBackend } from "../src/index.js";
import { FIXTURE_URL } from "./fixtureWebApp.js";

/**
 * Parte C3 del plan de ejecución: este es el primer ejercicio REAL de la suite de
 * conformidad escrita en C2, contra un backend de verdad (no el fake de las pruebas
 * unitarias del núcleo). Con un solo backend todavía no "falsa" la hipótesis del modelo
 * universal (eso es F2) — pero sí demuestra que el contrato es coherente y ejecutable.
 */

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.goto(FIXTURE_URL);
});

afterAll(async () => {
  await browser.close();
});

defineConformanceSuite({ describe, it, beforeAll, afterAll, expect }, "backend-web", async () => {
  const fixture: ConformanceFixture = {
    // La página ya está navegada (ver beforeAll de arriba) — `fromPage` no abre/cierra
    // su propio browser, así que el cierre real ocurre en el afterAll de este archivo.
    createBackend: async () => WebBackend.fromPage(page),
    scenarios: {
      // Botón "Entrar" del login: real, invocable, y NO soporta setValue — sirve para
      // dos escenarios del contrato a la vez.
      actionableButton: { nameContains: "Entrar" },
      // 20 filas "Editar" con el MISMO nombre accesible y sin data-testid propio —
      // exactamente el caso que descartó el hash de propiedades (D1).
      repeatedRows: { nameContains: "Editar", minCount: 20 },
      decorativeWrapperWithChildren: { exists: true },
      nodeWithoutSetValue: { nameContains: "Entrar" },
    },
  };
  return fixture;
});

describe("D2 — filter (region.filter) sobre el subárbol que matchea", () => {
  it("filtrar por role:'form' devuelve el formulario COMPLETO, no lo vacía de sus propios hijos", async () => {
    // Regresión: una primera implementación de `filter` re-aplicaba el mismo predicado
    // recursivamente incluso DEBAJO de un nodo que ya matchea, así que filtrar por
    // role:'form' terminaba vaciando el propio formulario (sus inputs/botón no tienen
    // ellos mismos role:'form'). Ver `applyFilter`/`collectFilterMatches` en pageScript.ts.
    const session = new Session(WebBackend.fromPage(page));
    const snapshot = await session.snapshot({ mode: "full", filter: { role: "form" } });

    // La raíz de la región (aquí, document.body — nadie pidió anclar en el form) se
    // conserva siempre; lo que el filtro reordena es SU DESCENDENCIA. El form matchea y
    // sube como hijo directo de la raíz, con TODO su propio subárbol intacto debajo.
    const form = snapshot.root.children.find((c) => c.role === "form");
    expect(form).toBeDefined();

    const countNodes = (node: { children: unknown[] }): number =>
      1 + node.children.reduce((sum: number, c) => sum + countNodes(c as { children: unknown[] }), 0);
    // El form con sus inputs, botón y párrafo de estado: bastante más que el nodo solo.
    expect(countNodes(form!)).toBeGreaterThan(3);
  });

  it("filtrar por role:'form' excluye las 20 filas de la tabla de clientes — el escape valve de tokens funciona", async () => {
    const session = new Session(WebBackend.fromPage(page));
    const scoped = await session.snapshot({ mode: "compact", filter: { role: "form" } });
    const unscoped = await session.snapshot({ mode: "compact" });

    expect(scoped.tokenEstimate).toBeLessThan(unscoped.tokenEstimate);
    expect(scoped.tokenEstimate).toBeLessThan(1000);
  });
});
