import type { Backend, BackendRegion, RawNode } from "../backend.js";
import type { ActionArgs, Locator, Verb } from "../types.js";

/**
 * Backend falso para las pruebas UNITARIAS del núcleo — NO es la suite de conformidad
 * (esa vive en `packages/core/conformance/` y corre contra backends reales). Este fake
 * solo necesita ser lo bastante fiel al contrato para ejercitar resolver/actions/session
 * sin levantar Playwright.
 */
export function createFakeBackend(options: {
  /**
   * Árbol fijo, o una función que lo produce en cada `query()`. La forma de función existe
   * porque un árbol real CAMBIA entre sondeos (una SPA que renderiza en varias etapas), y
   * sin poder simular eso no se puede probar la espera por estabilidad (ADR-0005).
   */
  tree: RawNode | (() => RawNode);
  /** Locators que "existen" ahora mismo — simula el estado vivo del DOM/UIA. */
  liveLocators?: Set<string>;
  onPerform?: (locator: Locator, verb: Verb, args: ActionArgs | undefined) => void;
}): Backend {
  const treeNow = (): RawNode =>
    typeof options.tree === "function" ? options.tree() : options.tree;
  const live = options.liveLocators ?? new Set((treeNow().locators ?? []).map((l) => l.value));

  return {
    id: "fake",
    async query(_region: BackendRegion): Promise<RawNode> {
      return treeNow();
    },
    async probeLocator(locator: Locator): Promise<boolean> {
      return live.has(locator.value);
    },
    async performAt(locator: Locator, verb: Verb, args?: ActionArgs): Promise<void> {
      options.onPerform?.(locator, verb, args);
    },
    async dispose(): Promise<void> {
      // no-op
    },
  };
}

export function node(partial: Partial<RawNode> & Pick<RawNode, "role" | "nativeRole">): RawNode {
  return {
    name: null,
    automationId: null,
    description: null,
    options: null,
    value: undefined,
    states: new Set(),
    bounds: null,
    decorative: false,
    supports: [],
    locators: [],
    children: [],
    backend: "fake",
    ...partial,
  };
}
