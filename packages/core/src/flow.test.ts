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
