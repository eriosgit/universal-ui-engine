/**
 * Espera a que el árbol de UI deje de cambiar (ADR-0005).
 *
 * Vive aparte porque tiene DOS consumidores con motivos distintos:
 *
 * - `runFlow`, para no actuar sobre una pantalla a medio renderizar (el caso que motivó
 *   el ADR: elegir el tipo de un ítem antes de la segunda etapa de render dejaba el
 *   formulario roto).
 * - `Session.catalog()`, porque un escaneo a medio cargar es PEOR que un error: devuelve
 *   un catálogo que parece completo. Medido contra una app real, dos escaneos de la misma
 *   URL dieron 960 y 207 nodos según cuándo cayera la captura.
 */

/** Reloj inyectable: los tests no deben esperar segundos reales. */
export type Clock = { now(): number; sleep(ms: number): Promise<void> };

export const realClock: Clock = {
  now: () => Date.now(),
  // `globalThis.setTimeout` en vez de `setTimeout` a secas: `core` no declara los tipos de
  // Node ni los del DOM (es agnóstico de entorno por diseño), pero el temporizador existe
  // en ambos y está estandarizado en el objeto global.
  sleep: (ms) =>
    new Promise((resolve) => {
      const timer = (
        globalThis as unknown as { setTimeout: (fn: () => void, ms: number) => unknown }
      ).setTimeout;
      timer(() => resolve(), ms);
    }),
};

export const DEFAULT_QUIET_MS = 500;
export const STABILITY_POLL_INTERVAL_MS = 300;

/**
 * Sondea `huella()` hasta que devuelva el MISMO valor durante `quietMs` seguidos.
 * Devuelve `false` si se agota `timeoutMs` sin lograr una ventana de silencio completa.
 *
 * La huella debe ser una forma NORMALIZADA (roles, nombres, jerarquía), no el árbol
 * crudo: un `bounds` que oscila un píxel no es "el árbol sigue cambiando".
 */
export async function waitForQuiet(
  huella: () => Promise<string>,
  quietMs: number,
  timeoutMs: number,
  clock: Clock,
): Promise<boolean> {
  const deadline = clock.now() + timeoutMs;
  let previa = await huella();
  let quietoDesde = clock.now();

  for (;;) {
    if (clock.now() - quietoDesde >= quietMs) return true;
    if (clock.now() >= deadline) return false;
    await clock.sleep(STABILITY_POLL_INTERVAL_MS);

    const actual = await huella();
    if (actual !== previa) {
      previa = actual;
      quietoDesde = clock.now();
    }
  }
}
