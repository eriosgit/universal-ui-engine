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

/** Menú lateral realista: cada enlace envuelto en un listitem homónimo — el patrón que
 * costaba el 85% de los tokens en un dashboard real (ver ADR-0003). */
function makeMenu(): UINode {
  return makeNode({
    uid: "nav",
    role: "navigation",
    children: ["inicio", "contactos", "reportes"].map((label, i) =>
      makeNode({
        uid: `li-${i}`,
        role: "listitem",
        name: label,
        children: [
          makeNode({ uid: `link-${i}`, role: "link", name: label, supports: ["invoke", "focus"] }),
        ],
      }),
    ),
  });
}

describe("collapseRedundantWrappers (ADR-0003)", () => {
  it("funde un envoltorio sin verbos con su único hijo homónimo (listitem 'inicio' > link 'inicio')", () => {
    const { root } = serialize(makeMenu(), "compact");

    expect(root.children).toHaveLength(3);
    // El listitem desapareció: queda directamente el link, con su uid intacto.
    expect(root.children.map((c) => c.role)).toEqual(["link", "link", "link"]);
    expect(root.children.map((c) => c.uid)).toEqual(["link-0", "link-1", "link-2"]);
  });

  it("NO colapsa un envoltorio con dos o más hijos: ahí la jerarquía sí agrupa", () => {
    const group = makeNode({
      uid: "group",
      role: "listitem",
      children: [
        makeNode({ uid: "a", role: "link", name: "uno", supports: ["invoke"] }),
        makeNode({ uid: "b", role: "link", name: "dos", supports: ["invoke"] }),
      ],
    });
    const { root } = serialize(makeNode({ uid: "root", role: "navigation", children: [group] }), "compact");

    expect(root.children[0]?.uid).toBe("group");
    expect(root.children[0]?.children).toHaveLength(2);
  });

  it("NO colapsa un nodo accionable, aunque tenga un solo hijo", () => {
    const button = makeNode({
      uid: "btn",
      role: "button",
      name: "Guardar",
      supports: ["invoke"],
      children: [makeNode({ uid: "icon", role: "image", name: "Guardar" })],
    });
    const { root } = serialize(makeNode({ uid: "root", role: "form", children: [button] }), "compact");

    expect(root.children[0]?.uid).toBe("btn");
  });

  it("reduce tokens de verdad frente a no colapsar", () => {
    const compact = serialize(makeMenu(), "compact");
    const full = serialize(makeMenu(), "full");
    expect(compact.tokenEstimate).toBeLessThan(full.tokenEstimate);
  });
});

describe("modo 'actionable' (ADR-0003)", () => {
  it("se queda solo con lo accionable y los headings, reparentando desde contenedores descartados", () => {
    const page = makeNode({
      uid: "root",
      role: "document",
      children: [
        makeMenu(),
        makeNode({
          uid: "main",
          role: "main",
          children: [
            makeNode({ uid: "h", role: "heading", name: "Pagos recibidos" }),
            makeNode({ uid: "texto", role: "generic", name: "¡Aún no tienes pagos!" }),
            makeNode({ uid: "nuevo", role: "button", name: "Nuevo pago", supports: ["invoke"] }),
          ],
        }),
      ],
    });

    const { root } = serialize(page, "actionable");

    const uids: string[] = [];
    (function walk(n: UINode) {
      uids.push(n.uid);
      n.children.forEach(walk);
    })(root);

    // Los 3 links del menú + el heading + el botón: nada de contenedores ni texto inerte.
    expect(uids).toEqual(["root", "link-0", "link-1", "link-2", "h", "nuevo"]);
    expect(uids).not.toContain("texto");
    expect(uids).not.toContain("main");
  });

  it("es sustancialmente más barato que compact sobre el mismo árbol", () => {
    const page = makeNode({
      uid: "root",
      role: "document",
      children: [
        makeMenu(),
        makeNode({
          uid: "main",
          role: "main",
          children: Array.from({ length: 15 }, (_, i) =>
            makeNode({ uid: `p-${i}`, role: "generic", name: `Párrafo informativo número ${i}` }),
          ),
        }),
      ],
    });

    const actionable = serialize(page, "actionable");
    const compact = serialize(page, "compact");

    expect(actionable.tokenEstimate).toBeLessThan(compact.tokenEstimate / 2);
  });

  it("conserva siempre la raíz, aunque no sea accionable", () => {
    const page = makeNode({ uid: "root", role: "document", children: [] });
    const { root } = serialize(page, "actionable");
    expect(root.uid).toBe("root");
  });
});
