import type { Predicate } from "./find.js";
import type { Session } from "./session.js";
import type { UINode, Verb } from "./types.js";

/**
 * F3 — Flujos: la razón de ser del proyecto.
 *
 * Un `Flow` es el ARTEFACTO que produce el trabajo caro de la IA: explorar una app con
 * `uui find`, descubrir qué controles hay y cómo se llaman. Una vez escrito, se ejecuta
 * sin IA, sin tokens y de forma reproducible — que es lo que separa "pídele a un agente
 * que lo haga" de "automatiza un proceso".
 *
 * Todos los pasos localizan por PREDICADO determinista (D7), nunca por coordenadas ni por
 * "lo que el modelo entendió ese día": por eso un flujo es versionable y revisable en un
 * PR como cualquier otro código.
 */

export type FlowStep =
  /** Lleva el backend al destino (Web: URL; UIA: app/ventana). Requiere `Backend.navigate`. */
  | { action: "goto"; target: string; label?: string }
  /** Espera a que un nodo exista antes de seguir. Sustituye a los `sleep` fijos. */
  | { action: "waitFor"; target: Predicate; timeoutMs?: number; label?: string }
  /**
   * Espera a que un campo tenga (o deje de tener) valor. Es la espera correcta para los
   * campos DERIVADOS: al escribir "Precio base" en un formulario real, la app recalcula
   * "Precio Total" de forma asíncrona, y guardar antes de que termine envía el formulario
   * incompleto. `waitFor` no sirve ahí porque el campo existe desde el principio: lo que
   * cambia es su valor.
   */
  | {
      action: "waitForValue";
      target: Predicate;
      /** Por defecto `nonEmpty`. */
      expect?: "nonEmpty" | "equals";
      value?: string;
      timeoutMs?: number;
      label?: string;
    }
  /** Ejecuta un verbo sobre el primer nodo que satisface el predicado. */
  | { action: "act"; target: Predicate; verb: Verb; value?: string; label?: string }
  /** Validación: si falla, el flujo se detiene. Es lo que convierte un script en una
   * automatización confiable — sin esto, un flujo "termina bien" habiendo hecho nada. */
  | {
      action: "expect";
      target: Predicate;
      assert: "exists" | "notExists" | "nameEquals" | "nameContains" | "count";
      value?: string;
      count?: number;
      label?: string;
    }
  /** Captura un dato del árbol para el resultado del flujo (p. ej. el nº de factura). */
  | { action: "extract"; name: string; target: Predicate; field?: "name" | "value"; label?: string };

export type Flow = {
  name: string;
  description?: string;
  /** Espera por defecto (ms) para `waitFor` y para localizar el objetivo de `act`/`expect`. */
  defaultTimeoutMs?: number;
  steps: FlowStep[];
};

export type StepResult = {
  index: number;
  step: FlowStep;
  status: "ok" | "failed";
  /** Milisegundos que tardó — la telemetría que permite saber qué paso es el lento. */
  durationMs: number;
  error?: string;
  /** Solo en `extract`. */
  extracted?: { name: string; value: string | null };
};

export type FlowResult = {
  flow: string;
  status: "ok" | "failed";
  steps: StepResult[];
  /** Datos capturados por los pasos `extract`, listos para consumir. */
  data: Record<string, string | null>;
  durationMs: number;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 300;

/** Reloj inyectable: los tests no deben esperar segundos reales. */
export type Clock = { now(): number; sleep(ms: number): Promise<void> };

const realClock: Clock = {
  now: () => Date.now(),
  // `globalThis.setTimeout` en vez de `setTimeout` a secas: `core` no declara los tipos de
  // Node ni los del DOM (es agnóstico de entorno por diseño), pero el temporizador existe
  // en ambos y está estandarizado en el objeto global.
  sleep: (ms) =>
    new Promise((resolve) => {
      const timer = (globalThis as unknown as {
        setTimeout: (fn: () => void, ms: number) => unknown;
      }).setTimeout;
      timer(() => resolve(), ms);
    }),
};

/**
 * Espera por CONDICIÓN, nunca por tiempo fijo. Reintenta hasta que el predicado encuentre
 * algo o se agote el plazo — así un flujo sobrevive a que la app tarde más o menos según
 * el día, que es exactamente lo que rompe a los scripts con `sleep` fijos.
 */
async function findWithRetry(
  session: Session,
  predicate: Predicate,
  timeoutMs: number,
  clock: Clock,
): Promise<UINode[]> {
  const deadline = clock.now() + timeoutMs;
  for (;;) {
    const matches = await session.find(predicate);
    if (matches.length > 0) return matches;
    if (clock.now() >= deadline) return [];
    await clock.sleep(POLL_INTERVAL_MS);
  }
}

/** Espera a que el valor de un campo cumpla una condición (ver `waitForValue`). */
async function waitForFieldValue(
  session: Session,
  predicate: Predicate,
  check: (value: string) => boolean,
  timeoutMs: number,
  clock: Clock,
): Promise<string | null> {
  const deadline = clock.now() + timeoutMs;
  for (;;) {
    const [node] = await session.find(predicate);
    const value = node?.value ?? null;
    if (value !== null && check(value)) return value;
    if (clock.now() >= deadline) return null;
    await clock.sleep(POLL_INTERVAL_MS);
  }
}

async function waitUntilGone(
  session: Session,
  predicate: Predicate,
  timeoutMs: number,
  clock: Clock,
): Promise<boolean> {
  const deadline = clock.now() + timeoutMs;
  for (;;) {
    const matches = await session.find(predicate);
    if (matches.length === 0) return true;
    if (clock.now() >= deadline) return false;
    await clock.sleep(POLL_INTERVAL_MS);
  }
}

function describe(step: FlowStep): string {
  if (step.label) return step.label;
  switch (step.action) {
    case "goto":
      return `goto ${step.target}`;
    case "waitFor":
      return "waitFor";
    case "waitForValue":
      return "waitForValue";
    case "act":
      return `act ${step.verb}`;
    case "expect":
      return `expect ${step.assert}`;
    case "extract":
      return `extract ${step.name}`;
  }
}

async function runStep(
  session: Session,
  step: FlowStep,
  timeoutMs: number,
  clock: Clock,
  data: Record<string, string | null>,
): Promise<{ extracted?: StepResult["extracted"] }> {
  switch (step.action) {
    case "goto": {
      const backend = session.backend;
      if (!backend.navigate) {
        throw new Error(
          `El backend '${backend.id}' no implementa navigate(): no admite pasos 'goto'.`,
        );
      }
      await backend.navigate(step.target);
      return {};
    }

    case "waitFor": {
      const found = await findWithRetry(session, step.target, step.timeoutMs ?? timeoutMs, clock);
      if (found.length === 0) {
        throw new Error(`No apareció ningún nodo que satisfaga el predicado tras ${step.timeoutMs ?? timeoutMs}ms.`);
      }
      return {};
    }

    case "waitForValue": {
      const esperado = step.value ?? "";
      const cumple = (value: string): boolean =>
        step.expect === "equals" ? value.trim() === esperado.trim() : value.trim().length > 0;
      const value = await waitForFieldValue(
        session,
        step.target,
        cumple,
        step.timeoutMs ?? timeoutMs,
        clock,
      );
      if (value === null) {
        throw new Error(
          step.expect === "equals"
            ? `El campo no llegó a valer "${esperado}" tras ${step.timeoutMs ?? timeoutMs}ms.`
            : `El campo siguió vacío tras ${step.timeoutMs ?? timeoutMs}ms.`,
        );
      }
      return {};
    }

    case "act": {
      const found = await findWithRetry(session, step.target, timeoutMs, clock);
      const target = found[0];
      if (!target) {
        throw new Error(`No se encontró el objetivo de la acción '${step.verb}' tras ${timeoutMs}ms.`);
      }
      await session.act(target.uid, step.verb, step.value !== undefined ? { value: step.value } : undefined);
      return {};
    }

    case "expect": {
      if (step.assert === "notExists") {
        const gone = await waitUntilGone(session, step.target, timeoutMs, clock);
        if (!gone) throw new Error("El nodo sigue presente y se esperaba que no existiera.");
        return {};
      }
      const found = await findWithRetry(session, step.target, timeoutMs, clock);
      if (step.assert === "exists") {
        if (found.length === 0) throw new Error("Se esperaba encontrar el nodo y no apareció.");
        return {};
      }
      if (step.assert === "count") {
        const expected = step.count ?? 0;
        if (found.length !== expected) {
          throw new Error(`Se esperaban ${expected} coincidencias y hubo ${found.length}.`);
        }
        return {};
      }
      const first = found[0];
      if (!first) throw new Error("Se esperaba encontrar el nodo y no apareció.");
      const actual = (first.name ?? "").trim();
      const expected = (step.value ?? "").trim();
      if (step.assert === "nameEquals" && actual.toLowerCase() !== expected.toLowerCase()) {
        throw new Error(`Se esperaba el nombre "${expected}" y se encontró "${actual}".`);
      }
      if (
        step.assert === "nameContains" &&
        !actual.toLowerCase().includes(expected.toLowerCase())
      ) {
        throw new Error(`Se esperaba que el nombre contuviera "${expected}" y era "${actual}".`);
      }
      return {};
    }

    case "extract": {
      const found = await findWithRetry(session, step.target, timeoutMs, clock);
      const node = found[0];
      const value = node ? ((step.field ?? "name") === "value" ? (node.value ?? null) : node.name) : null;
      data[step.name] = value;
      return { extracted: { name: step.name, value } };
    }
  }
}

/**
 * Ejecuta un flujo de principio a fin. Se detiene en el primer paso fallido — una
 * automatización que sigue adelante tras un error hace daño en vez de trabajo.
 */
export async function runFlow(
  session: Session,
  flow: Flow,
  options: { clock?: Clock } = {},
): Promise<FlowResult> {
  const clock = options.clock ?? realClock;
  const timeoutMs = flow.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const started = clock.now();
  const steps: StepResult[] = [];
  const data: Record<string, string | null> = {};
  let status: FlowResult["status"] = "ok";

  for (const [index, step] of flow.steps.entries()) {
    const stepStarted = clock.now();
    try {
      const { extracted } = await runStep(session, step, timeoutMs, clock, data);
      steps.push({
        index,
        step,
        status: "ok",
        durationMs: clock.now() - stepStarted,
        ...(extracted ? { extracted } : {}),
      });
    } catch (error) {
      steps.push({
        index,
        step,
        status: "failed",
        durationMs: clock.now() - stepStarted,
        error: `${describe(step)}: ${error instanceof Error ? error.message : String(error)}`,
      });
      status = "failed";
      break;
    }
  }

  return { flow: flow.name, status, steps, data, durationMs: clock.now() - started };
}
