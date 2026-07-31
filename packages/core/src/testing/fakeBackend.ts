import type { Backend, BackendRegion, RawNode } from "../backend.js";
import type { ActionArgs, Locator, Verb } from "../types.js";

/**
 * Backend falso para las pruebas UNITARIAS del núcleo — NO es la suite de conformidad
 * (esa vive en `packages/core/conformance/` y corre contra backends reales). Este fake
 * solo necesita ser lo bastante fiel al contrato para ejercitar resolver/actions/session
 * sin levantar Playwright.
 */
export function createFakeBackend(options: {
  tree: RawNode;
  /** Locators que "existen" ahora mismo — simula el estado vivo del DOM/UIA. */
  liveLocators?: Set<string>;
  onPerform?: (locator: Locator, verb: Verb, args: ActionArgs | undefined) => void;
}): Backend {
  const live = options.liveLocators ?? new Set((options.tree.locators ?? []).map((l) => l.value));

  return {
    id: "fake",
    async query(_region: BackendRegion): Promise<RawNode> {
      return options.tree;
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
