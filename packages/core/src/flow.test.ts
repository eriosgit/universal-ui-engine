import { describe, expect, it, vi } from "vitest";
import { runFlow, type Clock, type Flow } from "./flow.js";
import { Session } from "./session.js";
import { createFakeBackend, node } from "./testing/fakeBackend.js";
import type { RawNode } from "./backend.js";

/** Reloj falso: los tests no esperan segundos reales, pero el ejecutor sí cree que pasa
 * el tiempo — así se puede probar el vencimiento de plazos de forma determinista. */
function fakeClock(): Clock {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  };
}

const boton = (name: string, uidHint = "b") =>
  node({
    role: "button",
    nativeRole: "button",
    name,
    supports: ["invoke"],
    locators: [{ kind: "testId", value: `${uidHint}-${name}`, confidence: 0.9 }],
  });

describe("runFlow (F3 — el artefacto que corre sin IA)", () => {
  it("ejecuta los pasos en orden y reporta ok con la duración de cada uno", async () => {
    const onPerform = vi.fn();
    const tree = node({
      role: "form",
      nativeRole: "form",
      children: [boton("Guardar")],
    });
    const backend = createFakeBackend({
      tree,
      liveLocators: new Set(["b-Guardar"]),
      onPerform,
    });
    const session = new Session(backend);

    const flow: Flow = {
      name: "guardar",
      steps: [
        { action: "waitFor", target: { kind: "nameEquals", text: "Guardar" } },
        { action: "act", target: { kind: "nameEquals", text: "Guardar" }, verb: "invoke" },
        { action: "expect", target: { kind: "nameEquals", text: "Guardar" }, assert: "exists" },
      ],
    };

    const result = await runFlow(session, flow, { clock: fakeClock() });

    expect(result.status).toBe("ok");
    expect(result.steps.map((s) => s.status)).toEqual(["ok", "ok", "ok"]);
    expect(onPerform).toHaveBeenCalledTimes(1);
  });

  it("se DETIENE en el primer paso fallido: una automatización que sigue tras un error hace daño", async () => {
    const onPerform = vi.fn();
    const backend = createFakeBackend({
      tree: node({ role: "form", nativeRole: "form", children: [boton("Guardar")] }),
      liveLocators: new Set(["b-Guardar"]),
      onPerform,
    });
    const session = new Session(backend);

    const flow: Flow = {
      name: "con-paso-imposible",
      defaultTimeoutMs: 1000,
      steps: [
        { action: "act", target: { kind: "nameEquals", text: "No existe" }, verb: "invoke" },
        { action: "act", target: { kind: "nameEquals", text: "Guardar" }, verb: "invoke" },
      ],
    };

    const result = await runFlow(session, flow, { clock: fakeClock() });

    expect(result.status).toBe("failed");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.error).toMatch(/No se encontró el objetivo/);
    // El segundo paso NUNCA se ejecutó.
    expect(onPerform).not.toHaveBeenCalled();
  });

  it("waitFor espera por CONDICIÓN: sobrevive a que el nodo tarde en aparecer", async () => {
    // El árbol cambia a la tercera consulta — simula una SPA que termina de renderizar.
    let consultas = 0;
    const vacio = node({ role: "form", nativeRole: "form" });
    const conBoton = node({ role: "form", nativeRole: "form", children: [boton("Listo")] });
    const backend = {
      ...createFakeBackend({ tree: vacio, liveLocators: new Set(["b-Listo"]) }),
      query: async (): Promise<RawNode> => {
        consultas += 1;
        return consultas >= 3 ? conBoton : vacio;
      },
    };
    const session = new Session(backend);

    const flow: Flow = {
      name: "espera",
      defaultTimeoutMs: 5000,
      steps: [{ action: "waitFor", target: { kind: "nameEquals", text: "Listo" } }],
    };

    const result = await runFlow(session, flow, { clock: fakeClock() });

    expect(result.status).toBe("ok");
    expect(consultas).toBeGreaterThanOrEqual(3);
  });

  it("expect count valida cuántos elementos hay — la validación que convierte un script en automatización", async () => {
    const filas = Array.from({ length: 3 }, (_, i) => boton("Editar", `f${i}`));
    const backend = createFakeBackend({
      tree: node({ role: "table", nativeRole: "table", children: filas }),
    });
    const session = new Session(backend);

    const ok = await runFlow(
      session,
      {
        name: "contar",
        defaultTimeoutMs: 500,
        steps: [{ action: "expect", target: { kind: "nameEquals", text: "Editar" }, assert: "count", count: 3 }],
      },
      { clock: fakeClock() },
    );
    expect(ok.status).toBe("ok");

    const mal = await runFlow(
      session,
      {
        name: "contar-mal",
        defaultTimeoutMs: 500,
        steps: [{ action: "expect", target: { kind: "nameEquals", text: "Editar" }, assert: "count", count: 7 }],
      },
      { clock: fakeClock() },
    );
    expect(mal.status).toBe("failed");
    expect(mal.steps[0]?.error).toMatch(/Se esperaban 7 coincidencias y hubo 3/);
  });

  it("extract captura datos para el resultado del flujo", async () => {
    const backend = createFakeBackend({
      tree: node({
        role: "form",
        nativeRole: "form",
        children: [node({ role: "status", nativeRole: "output", name: "Factura FV-1042 creada" })],
      }),
    });
    const session = new Session(backend);

    const result = await runFlow(
      session,
      {
        name: "extraer",
        defaultTimeoutMs: 500,
        steps: [
          { action: "extract", name: "confirmacion", target: { kind: "role", role: "status" } },
        ],
      },
      { clock: fakeClock() },
    );

    expect(result.status).toBe("ok");
    expect(result.data["confirmacion"]).toBe("Factura FV-1042 creada");
  });

  it("goto falla con un mensaje claro si el backend no sabe navegar", async () => {
    const backend = createFakeBackend({ tree: node({ role: "form", nativeRole: "form" }) });
    const session = new Session(backend);

    const result = await runFlow(
      session,
      { name: "ir", steps: [{ action: "goto", target: "https://ejemplo.com" }] },
      { clock: fakeClock() },
    );

    expect(result.status).toBe("failed");
    expect(result.steps[0]?.error).toMatch(/no implementa navigate/);
  });
});

/**
 * ADR-0005. El caso que motivó el paso: una SPA que renderiza el formulario en dos etapas.
 * Esperar a que un campo sea VISIBLE se cumple en la primera etapa, y actuar ahí deja el
 * formulario a medio inicializar. Aquí se simula con un árbol que crece entre sondeos.
 */
describe("waitForStable — esperar a que el árbol deje de cambiar", () => {
  /** Árbol que gana un campo nuevo en cada uno de los primeros `etapas` sondeos. */
  function arbolQueCrece(etapas: number): { tree: () => RawNode; sondeos: () => number } {
    let n = 0;
    return {
      tree: () => {
        const campos = Array.from({ length: Math.min(n, etapas) }, (_, i) =>
          boton(`Campo ${i + 1}`, `c${i + 1}`),
        );
        n += 1;
        return node({ role: "form", nativeRole: "form", children: [boton("Nombre"), ...campos] });
      },
      sondeos: () => n,
    };
  }

  it("no vuelve hasta que la forma del árbol se repite durante toda la ventana de silencio", async () => {
    const { tree } = arbolQueCrece(3);
    const session = new Session(createFakeBackend({ tree }));

    const result = await runFlow(
      session,
      {
        name: "estable",
        steps: [{ action: "waitForStable", quietMs: 600, timeoutMs: 10_000 }],
      },
      { clock: fakeClock() },
    );

    expect(result.status).toBe("ok");
    // El árbol dejó de crecer en el sondeo 3; la ventana de 600ms son 2 sondeos más de
    // 300ms sin cambios. Volver antes significaría actuar sobre un árbol a medio renderizar.
    expect(result.steps[0]?.durationMs).toBeGreaterThanOrEqual(600);
  });

  it("falla con un mensaje accionable si el árbol nunca se aquieta", async () => {
    // Árbol que cambia para siempre: una animación o un contador visible en la página.
    const { tree } = arbolQueCrece(Number.MAX_SAFE_INTEGER);
    const session = new Session(createFakeBackend({ tree }));

    const result = await runFlow(
      session,
      {
        name: "inquieto",
        steps: [{ action: "waitForStable", quietMs: 500, timeoutMs: 2000 }],
      },
      { clock: fakeClock() },
    );

    expect(result.status).toBe("failed");
    expect(result.steps[0]?.error).toMatch(/sigui[óo] cambiando/i);
  });

  it("vuelve enseguida si el árbol ya estaba quieto", async () => {
    const session = new Session(
      createFakeBackend({
        tree: node({ role: "form", nativeRole: "form", children: [boton("Nombre")] }),
      }),
    );

    const result = await runFlow(
      session,
      { name: "quieto", steps: [{ action: "waitForStable", quietMs: 300 }] },
      { clock: fakeClock() },
    );

    expect(result.status).toBe("ok");
    expect(result.steps[0]?.durationMs).toBeLessThanOrEqual(600);
  });
});
