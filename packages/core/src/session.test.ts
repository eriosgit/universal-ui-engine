import { describe, expect, it, vi } from "vitest";
import { Session } from "./session.js";
import { createFakeBackend, node } from "./testing/fakeBackend.js";

describe("Session (D1 — registro uid↔fingerprint de sesión, nunca handles vivos)", () => {
  it("snapshot asigna uids opacos y no expone locators/raw crudos del backend en modo compact", async () => {
    const tree = node({
      role: "form",
      nativeRole: "form",
      children: [
        node({
          role: "button",
          nativeRole: "button",
          name: "Guardar",
          supports: ["invoke"],
          locators: [{ kind: "testId", value: "save", confidence: 0.9 }],
        }),
      ],
    });
    const backend = createFakeBackend({ tree });
    const session = new Session(backend);

    const snapshot = await session.snapshot();

    expect(snapshot.root.uid).toMatch(/^fake:\d+$/);
    expect(snapshot.root.children[0]?.uid).toMatch(/^fake:\d+$/);
    expect(snapshot.root.children[0]?.uid).not.toBe(snapshot.root.uid);
    expect(snapshot.tokenEstimate).toBeGreaterThan(0);
  });

  it("act re-resuelve el fingerprint registrado y ejecuta el verbo — el uid nunca fue un handle", async () => {
    const saveLocator = { kind: "testId" as const, value: "save", confidence: 0.9 };
    const tree = node({
      role: "button",
      nativeRole: "button",
      name: "Guardar",
      supports: ["invoke"],
      locators: [saveLocator],
    });
    const onPerform = vi.fn();
    const backend = createFakeBackend({ tree, liveLocators: new Set([saveLocator.value]), onPerform });
    const session = new Session(backend);

    const snapshot = await session.snapshot();
    await session.act(snapshot.root.uid, "invoke");

    expect(onPerform).toHaveBeenCalledWith(saveLocator, "invoke", undefined);
  });

  it("rechaza un uid que esta sesión nunca emitió", async () => {
    const backend = createFakeBackend({ tree: node({ role: "form", nativeRole: "form" }) });
    const session = new Session(backend);

    await expect(session.act("otra-sesion:1", "invoke")).rejects.toThrow(/uid desconocido/);
  });

  it("find también registra uids re-actuables sobre los nodos encontrados", async () => {
    const editLocator = { kind: "testId" as const, value: "edit-3", confidence: 0.9 };
    const tree = node({
      role: "table",
      nativeRole: "table",
      children: [
        node({ role: "button", nativeRole: "button", name: "Editar", supports: ["invoke"], locators: [editLocator] }),
      ],
    });
    const onPerform = vi.fn();
    const backend = createFakeBackend({ tree, liveLocators: new Set([editLocator.value]), onPerform });
    const session = new Session(backend);

    const [match] = await session.find({ kind: "nameContains", text: "editar" });
    expect(match).toBeDefined();

    await session.act(match!.uid, "invoke");
    expect(onPerform).toHaveBeenCalledWith(editLocator, "invoke", undefined);
  });
});
