import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { normalizeShape, Session } from "@uui/core";
import { WebBackend } from "../src/index.js";
import { FIXTURE_URL } from "./fixtureWebApp.js";

/**
 * §6: golden trees comparados por FORMA NORMALIZADA (roles + nombres + jerarquía), nunca
 * por igualdad estricta — así una app real no rompe CI por cambiar de resolución/tema/SO.
 * Usamos el snapshot de vitest (`toMatchSnapshot`) como almacén del árbol dorado: es
 * exactamente ese mecanismo (comparar contra un archivo versionado, fallar en
 * discrepancia, poder refrescar deliberadamente con `--update`) sin reinventarlo.
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

describe("Golden trees — fixtures/web-app", () => {
  it("la forma normalizada del snapshot compact coincide con el árbol dorado versionado", async () => {
    const session = new Session(WebBackend.fromPage(page));
    const snapshot = await session.snapshot({ mode: "compact" });
    expect(normalizeShape(snapshot.root)).toMatchSnapshot();
  });

  it("la forma normalizada del snapshot full (con decorativos) también coincide con su árbol dorado", async () => {
    const session = new Session(WebBackend.fromPage(page));
    const snapshot = await session.snapshot({ mode: "full" });
    expect(normalizeShape(snapshot.root)).toMatchSnapshot();
  });
});
