import type { Flow } from "@uui/core";
import { generatePlaywrightTs, type PlaywrightOptions } from "./playwrightTs.js";
import { generatePlaywrightPy } from "./playwrightPy.js";

export * from "./playwrightTs.js";
export * from "./playwrightPy.js";
export * from "./predicateText.js";

export const TARGETS = ["playwright-ts", "playwright-test", "playwright-py"] as const;
export type Target = (typeof TARGETS)[number];

export function generate(flow: Flow, target: Target, options: PlaywrightOptions = {}): string {
  switch (target) {
    case "playwright-ts":
      return generatePlaywrightTs(flow, options);
    case "playwright-test":
      return generatePlaywrightTs(flow, { ...options, asTest: true });
    case "playwright-py":
      return generatePlaywrightPy(flow, options);
  }
}

/** Extensión de archivo sugerida para cada target — la usa `uui codegen -o`. */
export function extensionFor(target: Target): string {
  return target === "playwright-py" ? ".py" : ".ts";
}
