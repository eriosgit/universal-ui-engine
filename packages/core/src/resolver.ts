import type { Backend } from "./backend.js";
import type { Fingerprint, Locator, LocatorKind } from "./types.js";

/**
 * D1 + F1 ("ranking de locators + reintento con degradación"): el orden en que se
 * intentan los locators de un fingerprint. Vive en el núcleo, no en el backend — es
 * precisamente la política que hace que un mismo script sobreviva a un rediseño de CSS
 * (F1, demo de salida): degrada a algo más frágil solo cuando lo robusto ya falló.
 *
 * `automationId` (UIA) y `sapId` (SAP GUI) son equivalentes nativos de `testId` — mismo
 * escalón de prioridad, porque ambos son identificadores estables asignados a propósito
 * por quien construyó la UI, igual que un `data-testid` web.
 */
const DEGRADATION_TIERS: LocatorKind[][] = [
  ["testId", "automationId", "sapId"],
  ["role+name"],
  ["css"],
  ["xpath"],
  ["coords"],
];

const TIER_INDEX = new Map<LocatorKind, number>(
  DEGRADATION_TIERS.flatMap((kinds, tier) => kinds.map((kind) => [kind, tier] as const)),
);

function tierOf(kind: LocatorKind): number {
  return TIER_INDEX.get(kind) ?? DEGRADATION_TIERS.length;
}

/** Orden estable: primero por escalón de degradación, luego por confianza descendente
 * dentro del mismo escalón. */
export function byDegradationOrder(a: Locator, b: Locator): number {
  const tierDiff = tierOf(a.kind) - tierOf(b.kind);
  if (tierDiff !== 0) return tierDiff;
  return b.confidence - a.confidence;
}

export type LocatorAttempt = { locator: Locator; ok: boolean };

export type ResolveResult =
  | { resolved: true; locator: Locator; attempts: LocatorAttempt[] }
  | { resolved: false; locator: null; attempts: LocatorAttempt[] };

/**
 * Intenta re-resolver un fingerprint contra el estado ACTUAL del backend, en orden de
 * degradación, y se detiene en el primer locator que resuelve a un elemento vivo.
 * Esta función es la que hace que el `uid` (D1) nunca sea un handle: cada acción la
 * vuelve a llamar en vez de reusar una referencia que pudo haber muerto en un re-render.
 */
export async function resolveFingerprint(
  backend: Pick<Backend, "probeLocator">,
  fingerprint: Fingerprint,
): Promise<ResolveResult> {
  const attempts: LocatorAttempt[] = [];
  const ordered = [...fingerprint.locators].sort(byDegradationOrder);

  for (const locator of ordered) {
    const ok = await backend.probeLocator(locator);
    attempts.push({ locator, ok });
    if (ok) {
      return { resolved: true, locator, attempts };
    }
  }

  return { resolved: false, locator: null, attempts };
}
