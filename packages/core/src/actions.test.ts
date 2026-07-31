import { describe, expect, it, vi } from "vitest";
import { UnresolvableFingerprintError, UnsupportedVerbError, performVerb } from "./actions.js";
import { createFakeBackend } from "./testing/fakeBackend.js";
import type { Locator } from "./types.js";

function locator(kind: Locator["kind"], value: string): Locator {
  return { kind, value, confidence: 0.9 };
}

const emptyTree = {
  role: "button" as const,
  nativeRole: "button",
  name: null,
  automationId: null,
  description: null,
  options: null,
  value: undefined,
  states: new Set<never>(),
  bounds: null,
  decorative: false,
  supports: [],
  locators: [],
  children: [],
  backend: "fake",
};

describe("performVerb (D6 — el nodo declara capacidades, no el backend su identidad)", () => {
  it("ejecuta el verbo cuando el nodo lo declara soportado", async () => {
    const testId = locator("testId", "save-button");
    const onPerform = vi.fn();
    const backend = createFakeBackend({
      tree: emptyTree,
      liveLocators: new Set([testId.value]),
      onPerform,
    });

    const result = await performVerb(
      backend,
      { supports: ["invoke"], fingerprint: { locators: [testId], path: [] } },
      "invoke",
    );

    expect(result.resolution.resolved).toBe(true);
    expect(onPerform).toHaveBeenCalledWith(testId, "invoke", undefined);
  });

  it("rechaza explícitamente un verbo no soportado por el NODO, sin preguntar qué backend es", async () => {
    const backend = createFakeBackend({ tree: emptyTree });

    await expect(
      performVerb(backend, { supports: ["focus"], fingerprint: { locators: [], path: [] } }, "toggle"),
    ).rejects.toThrow(UnsupportedVerbError);
  });

  it("falla explícito (no degrada a coordenadas) cuando el fingerprint no resuelve — la degradación a coords es F1", async () => {
    const backend = createFakeBackend({ tree: emptyTree, liveLocators: new Set() });

    await expect(
      performVerb(
        backend,
        { supports: ["invoke"], fingerprint: { locators: [locator("testId", "gone")], path: [] } },
        "invoke",
      ),
    ).rejects.toThrow(UnresolvableFingerprintError);
  });
});
