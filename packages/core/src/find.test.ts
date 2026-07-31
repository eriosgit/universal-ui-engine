import { describe, expect, it } from "vitest";
import { find } from "./find.js";
import type { UINode } from "./types.js";

function makeNode(partial: Partial<UINode> & Pick<UINode, "uid" | "role">): UINode {
  return {
    nativeRole: partial.role,
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

describe("find (D7 — determinista y componible)", () => {
  it("filtra por rol", () => {
    const root = makeNode({
      uid: "root",
      role: "form",
      children: [
        makeNode({ uid: "1", role: "textbox" }),
        makeNode({ uid: "2", role: "button" }),
      ],
    });

    const matches = find(root, { kind: "role", role: "button" });

    expect(matches.map((m) => m.node.uid)).toEqual(["2"]);
  });

  it("filtra por nombre, normalizado (case/espacios)", () => {
    const root = makeNode({
      uid: "root",
      role: "form",
      children: [makeNode({ uid: "1", role: "button", name: "  Guardar Cliente " })],
    });

    const matches = find(root, { kind: "nameContains", text: "guardar" });

    expect(matches.map((m) => m.node.uid)).toEqual(["1"]);
  });

  it("compone predicados con 'and': el botón de guardar DEL FORMULARIO DE CLIENTE", () => {
    const root = makeNode({
      uid: "root",
      role: "form",
      children: [
        makeNode({ uid: "wrong", role: "button", name: "Guardar" }), // otro botón "Guardar"
        makeNode({ uid: "right", role: "button", name: "Guardar cliente" }),
      ],
    });

    const matches = find(root, {
      kind: "and",
      all: [{ kind: "role", role: "button" }, { kind: "nameContains", text: "cliente" }],
    });

    expect(matches.map((m) => m.node.uid)).toEqual(["right"]);
  });

  it("no colapsa nodos idénticos: 20 filas con botón 'Editar' devuelven 20 uids distintos (motivo por el que D1 descartó el hash de propiedades)", () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      makeNode({ uid: `edit-${i}`, role: "button", name: "Editar" }),
    );
    const root = makeNode({ uid: "root", role: "table", children: rows });

    const matches = find(root, { kind: "nameContains", text: "editar" });

    expect(matches).toHaveLength(20);
    expect(new Set(matches.map((m) => m.node.uid)).size).toBe(20);
  });

  it("nameEquals distingue el campo de un formulario de la caja de búsqueda que lo menciona", () => {
    // Regresión de un fallo real: al crear un ítem en un SaaS de facturación,
    // nameContains:"Nombre" coincidió primero con "Buscar por nombre o referencia" y el
    // agente escribió en el buscador en vez del campo, enviando el formulario vacío.
    const root = makeNode({
      uid: "root",
      role: "form",
      children: [
        makeNode({ uid: "buscador", role: "textbox", name: "Buscar por nombre o referencia" }),
        makeNode({ uid: "campo", role: "textbox", name: "Nombre*" }),
      ],
    });

    expect(find(root, { kind: "nameContains", text: "Nombre" }).map((m) => m.node.uid)).toEqual([
      "buscador",
      "campo",
    ]);
    // Exacto: solo el campo. Y tolera el '*' de obligatoriedad del label.
    expect(find(root, { kind: "nameEquals", text: "Nombre" }).map((m) => m.node.uid)).toEqual([
      "campo",
    ]);
  });

  it("nameEquals normaliza espacios y mayúsculas, pero no hace coincidencias parciales", () => {
    const root = makeNode({
      uid: "root",
      role: "form",
      children: [makeNode({ uid: "a", role: "textbox", name: "  Precio   Base  " })],
    });

    expect(find(root, { kind: "nameEquals", text: "precio base" }).map((m) => m.node.uid)).toEqual(["a"]);
    expect(find(root, { kind: "nameEquals", text: "Precio" })).toHaveLength(0);
  });

  it("cada match trae el predicado que lo produjo — la explicación que D7 exige para F3", () => {
    const root = makeNode({ uid: "root", role: "button", name: "Guardar" });
    const predicate = { kind: "role" as const, role: "button" as const };

    const [match] = find(root, predicate);

    expect(match?.predicate).toEqual(predicate);
  });
});
