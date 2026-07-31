import { describe, expect, it } from "vitest";
import { pruneDecorative, serialize } from "./serialize.js";
import type { UINode } from "./types.js";

function makeNode(partial: Partial<UINode> & Pick<UINode, "uid" | "role">): UINode {
  return {
    nativeRole: partial.role,
    name: null,
    value: undefined,
    states: new Set(),
    bounds: { x: 0, y: 0, w: 10, h: 10 },
    decorative: false,
    supports: [],
    locators: [],
    children: [],
    backend: "fake",
    ...partial,
  };
}

describe("pruneDecorative (D4)", () => {
  it("elimina un nodo decorativo y reparenta a sus hijos en el ancestro no decorativo más cercano", () => {
    // form > div(decorativo) > div(decorativo) > input
    const input = makeNode({ uid: "3", role: "textbox" });
    const innerDiv = makeNode({ uid: "2", role: "generic", decorative: true, children: [input] });
    const form = makeNode({ uid: "1", role: "form", children: [innerDiv] });

    const pruned = pruneDecorative(form);

    expect(pruned.children).toHaveLength(1);
    expect(pruned.children[0]?.uid).toBe("3");
  });

  it("nunca destruye contenido: un decorativo con dos hijos reales sube ambos al padre", () => {
    const a = makeNode({ uid: "a", role: "button" });
    const b = makeNode({ uid: "b", role: "button" });
    const wrapper = makeNode({ uid: "wrap", role: "generic", decorative: true, children: [a, b] });
    const root = makeNode({ uid: "root", role: "form", children: [wrapper] });

    const pruned = pruneDecorative(root);

    expect(pruned.children.map((c) => c.uid)).toEqual(["a", "b"]);
  });

  it("lanza si la raíz de la región es decorativa — es un defecto del backend, no del serializador", () => {
    const root = makeNode({ uid: "root", role: "generic", decorative: true });
    expect(() => pruneDecorative(root)).toThrow(/no puede ser 'decorative'/);
  });
});

describe("serialize", () => {
  it("compact: omite bounds y raw, y poda decorativos", () => {
    const decorative = makeNode({ uid: "d", role: "generic", decorative: true, raw: { native: true } });
    const button = makeNode({ uid: "b", role: "button", name: "Guardar", raw: { native: true } });
    const root = makeNode({ uid: "root", role: "form", children: [decorative, button] });

    const { root: result } = serialize(root, "compact");

    expect(result.children).toHaveLength(1);
    expect(result.children[0]?.uid).toBe("b");
    expect(result.bounds).toBeNull();
    expect(result.children[0]?.bounds).toBeNull();
    expect(result).not.toHaveProperty("raw");
    expect(result.children[0]).not.toHaveProperty("raw");
  });

  it("full: conserva decorativos y bounds, pero sigue sin exponer raw (nunca leído por el núcleo)", () => {
    const decorative = makeNode({ uid: "d", role: "generic", decorative: true, raw: { native: true } });
    const root = makeNode({ uid: "root", role: "form", children: [decorative] });

    const { root: result } = serialize(root, "full");

    expect(result.children).toHaveLength(1);
    expect(result.children[0]?.decorative).toBe(true);
    expect(result.bounds).not.toBeNull();
    expect(result).not.toHaveProperty("raw");
  });

  it("expone tokenEstimate como un número positivo y creciente con el tamaño del árbol", () => {
    const small = makeNode({ uid: "root", role: "form" });
    const big = makeNode({
      uid: "root",
      role: "form",
      children: Array.from({ length: 20 }, (_, i) => makeNode({ uid: `row-${i}`, role: "row", name: `Fila ${i}` })),
    });

    const smallResult = serialize(small, "compact");
    const bigResult = serialize(big, "compact");

    expect(smallResult.tokenEstimate).toBeGreaterThan(0);
    expect(bigResult.tokenEstimate).toBeGreaterThan(smallResult.tokenEstimate);
  });
});
