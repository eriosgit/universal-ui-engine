import type { Backend } from "./backend.js";
import { resolveFingerprint, type ResolveResult } from "./resolver.js";
import type { ActionArgs, Fingerprint, Verb } from "./types.js";

export class UnsupportedVerbError extends Error {
  constructor(
    public readonly verb: Verb,
    public readonly supports: Verb[],
  ) {
    super(
      `El nodo no declara soporte para '${verb}' (soporta: ${supports.join(", ") || "ninguno"}). ` +
        `core pregunta capacidades del nodo, nunca identidad de backend (D6, ADR-0002) — ` +
        `esto no es un fallback recuperable automáticamente en F0.`,
    );
    this.name = "UnsupportedVerbError";
  }
}

export class UnresolvableFingerprintError extends Error {
  constructor(public readonly resolution: Extract<ResolveResult, { resolved: false }>) {
    super(
      `Ningún locator del fingerprint resolvió a un elemento vivo tras ${resolution.attempts.length} intento(s).`,
    );
    this.name = "UnresolvableFingerprintError";
  }
}

export type ActResult = {
  verb: Verb;
  resolution: ResolveResult;
};

/**
 * D6: compone una acción de alto nivel a partir de primitivas declaradas POR EL NODO.
 * No hay `if (backend === '...')` posible aquí porque nunca se le pregunta al backend
 * "qué eres" — solo "¿puedes hacer esto?" vía `supports`.
 *
 * Nota (F0→F1): cuando el nodo no soporta el verbo, F0 falla explícito en vez de degradar
 * a un clic por coordenadas. Esa degradación es del resorte de F1 ("reintento con
 * degradación") — construirla aquí adelantaría trabajo de otra fase sin sus pruebas.
 */
export async function performVerb(
  backend: Backend,
  node: { supports: Verb[]; fingerprint: Fingerprint },
  verb: Verb,
  args?: ActionArgs,
): Promise<ActResult> {
  if (!node.supports.includes(verb)) {
    throw new UnsupportedVerbError(verb, node.supports);
  }

  const resolution = await resolveFingerprint(backend, node.fingerprint);
  if (!resolution.resolved) {
    throw new UnresolvableFingerprintError(resolution);
  }

  await backend.performAt(resolution.locator, verb, args);
  return { verb, resolution };
}
