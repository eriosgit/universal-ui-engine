import { describe, expect, it } from "vitest";
import { byDegradationOrder, resolveFingerprint } from "./resolver.js";
import { createFakeBackend } from "./testing/fakeBackend.js";
import type { Locator } from "./types.js";

function locator(kind: Locator["kind"], value: string, confidence = 0.5): Locator {
  return { kind, value, confidence };
}

describe("byDegradationOrder", () => {
  it("ordena por escalón antes que por confianza: un css de alta confianza pierde contra un testId de baja", () => {
    const css = locator("css", "css-sel", 0.99);
    const testId = locator("testId", "save-button", 0.4);
    expect([css, testId].sort(byDegradationOrder)).toEqual([testId, css]);
  });

  it("trata automationId y sapId como el mismo escalón que testId", () => {
    const xpath = locator("xpath", "//button", 0.9);
    const automationId = locator("automationId", "SaveBtn", 0.3);
    expect([xpath, automationId].sort(byDegradationOrder)).toEqual([automationId, xpath]);
  });

  it("dentro del mismo escalón, desempata por confianza descendente", () => {
    const low = locator("role+name", "button:Guardar", 0.2);
    const high = locator("role+name", "button:Guardar (exacto)", 0.9);
    expect([low, high].sort(byDegradationOrder)).toEqual([high, low]);
  });
});

describe("resolveFingerprint", () => {
  it("se detiene en el primer locator que resuelve — no prueba los más frágiles si uno robusto ya sirvió", async () => {
    const testId = locator("testId", "save-button");
    const xpath = locator("xpath", "//button[3]");
    const backend = createFakeBackend({
      tree: { role: "button", nativeRole: "button", name: null, states: new Set(), bounds: null, decorative: false, supports: [], locators: [], children: [], backend: "fake" },
      liveLocators: new Set([testId.value]),
    });

    const result = await resolveFingerprint(backend, { locators: [xpath, testId], path: [] });

    expect(result.resolved).toBe(true);
    if (result.resolved) {
      expect(result.locator).toEqual(testId);
    }
    // Solo debió intentar testId (escalón más robusto primero) y no necesitar el xpath.
    expect(result.attempts).toEqual([{ locator: testId, ok: true }]);
  });

  it("degrada al siguiente escalón cuando el más robusto ya no existe (auto-healing, F1)", async () => {
    const testId = locator("testId", "save-button-old");
    const roleAndName = locator("role+name", "button:Guardar");
    const backend = createFakeBackend({
      tree: { role: "button", nativeRole: "button", name: null, states: new Set(), bounds: null, decorative: false, supports: [], locators: [], children: [], backend: "fake" },
      liveLocators: new Set([roleAndName.value]), // el testId "murió" en un rediseño
    });

    const result = await resolveFingerprint(backend, { locators: [testId, roleAndName], path: [] });

    expect(result.resolved).toBe(true);
    expect(result.attempts).toEqual([
      { locator: testId, ok: false },
      { locator: roleAndName, ok: true },
    ]);
  });

  it("reporta no resuelto y todos los intentos cuando ningún locator sirve", async () => {
    const testId = locator("testId", "gone");
    const backend = createFakeBackend({
      tree: { role: "button", nativeRole: "button", name: null, states: new Set(), bounds: null, decorative: false, supports: [], locators: [], children: [], backend: "fake" },
      liveLocators: new Set(),
    });

    const result = await resolveFingerprint(backend, { locators: [testId], path: [] });

    expect(result.resolved).toBe(false);
    expect(result.locator).toBeNull();
    expect(result.attempts).toEqual([{ locator: testId, ok: false }]);
  });
});
