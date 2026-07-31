import type { SerializeMode, UINode } from "./types.js";

/**
 * D4: la poda ocurre SOLO aquí, al serializar — nunca en el backend. Un nodo `decorative`
 * desaparece y sus hijos se REPARENTAN al ancestro no decorativo más cercano; sin
 * reparentar, `compact` perdería contenido real (p. ej. los campos de un formulario
 * envueltos en tres `div`s de maquetación sin nombre accesible).
 */
function pruneAndReparent(node: UINode): UINode[] {
  const prunedChildren = node.children.flatMap(pruneAndReparent);
  if (node.decorative) {
    return prunedChildren;
  }
  return [{ ...node, children: prunedChildren }];
}

export function pruneDecorative(root: UINode): UINode {
  if (root.decorative) {
    // Invariante del contrato: el nodo raíz de una región nunca es andamiaje puro —
    // es el ancla que el consumidor pidió explícitamente. Si un backend lo marca
    // decorativo, es un defecto del backend, no algo que este serializador deba resolver.
    throw new Error(
      "pruneDecorative: el nodo raíz de la región no puede ser 'decorative'. " +
        `(uid=${root.uid}, nativeRole=${root.nativeRole})`,
    );
  }
  return { ...root, children: root.children.flatMap(pruneAndReparent) };
}

/**
 * Campos que nunca deben llegar a un consumidor externo, en NINGÚN modo:
 *
 * - `raw`: la escotilla de escape por backend, declarada como "NUNCA leída por el
 *   núcleo" — y por extensión, nunca reexpuesta a quien consume `core` (agente vía
 *   MCP/CLI).
 * - `locators`: es el mecanismo INTERNO detrás del `uid` opaco (D1) — el fingerprint ya
 *   vive en el registro de la sesión (session.ts), indexado por `uid`. Exponer los
 *   locators crudos (rutas css/xpath completas, por nodo) violaría la opacidad que D1
 *   exige y — de paso — es la principal fuente de bloat de tokens (§3): un `uid` corto
 *   ya es toda la referencia que el consumidor necesita para volver a actuar.
 */
export function stripInternalFields(node: UINode): UINode {
  const { raw: _raw, locators: _locators, value, ...rest } = node;
  return {
    ...rest,
    // `value` también se omite cuando es null/undefined en vez de serializarlo
    // explícito — es el caso inmensamente mayoritario (solo inputs/textarea/select
    // tienen un valor real) y "null" repetido en cada nodo es ruido puro de tokens.
    ...(value != null ? { value } : {}),
    children: node.children.map(stripInternalFields),
  };
}

/** `compact` (§3): omite `bounds` además de `raw`. Los locators y `decorative` ya fueron
 * consumidos por `pruneDecorative` antes de llegar aquí. */
function projectCompact(node: UINode): UINode {
  const { origin: _origin, ...rest } = node;
  return {
    ...rest,
    bounds: null,
    children: node.children.map(projectCompact),
  };
}

export type SerializeResult = { root: UINode; tokenEstimate: number };

/**
 * Heurística de tokens (§3: "métrica obligatoria en telemetría... p95 objetivo < 3.000").
 * No es un tokenizer real — es deliberadamente barata para poder medirse en cada
 * snapshot sin costo. Cambiar la heurística por un tokenizer real es un cambio de
 * implementación, no de contrato: el campo `tokenEstimate` no cambia de forma.
 */
function estimateTokens(root: UINode): number {
  const json = JSON.stringify(root, (_key, value) => (value instanceof Set ? [...value] : value));
  return Math.ceil(json.length / 4);
}

export function serialize(root: UINode, mode: SerializeMode): SerializeResult {
  const stripped = stripInternalFields(root);
  const projected = mode === "compact" ? projectCompact(pruneDecorative(stripped)) : stripped;
  return { root: projected, tokenEstimate: estimateTokens(projected) };
}
