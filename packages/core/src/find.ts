import type { Role, UINode } from "./types.js";

/**
 * D7: el núcleo de `find` es SIEMPRE determinista y componible. Una capa semántica
 * (F1 — "consulta semántica → nodo") puede rankear resultados, pero debe devolver, junto
 * al nodo, cuál de estos predicados usó — porque un flujo grabado (F3) tiene que poder
 * generar un selector reproducible, no "lo que el modelo entendió ese día".
 *
 * F0 implementa el subconjunto que ya necesita el MCP (`role`, `name`, composición `and`).
 * `ancestor`/`descendant` y el ranking semántico son F1 ("Buscador inteligente") — no se
 * adelantan aquí para no construir F1 sin sus propias pruebas.
 */
export type Predicate =
  | { kind: "role"; role: Role }
  | { kind: "nameContains"; text: string }
  | { kind: "and"; all: Predicate[] };

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

export function matches(node: UINode, predicate: Predicate): boolean {
  switch (predicate.kind) {
    case "role":
      return node.role === predicate.role;
    case "nameContains":
      return node.name !== null && normalize(node.name).includes(normalize(predicate.text));
    case "and":
      return predicate.all.every((p) => matches(node, p));
  }
}

export type FindMatch = {
  node: UINode;
  /** El predicado determinista que produjo este match — la "explicación" que D7 exige
   * para que el resultado sea serializable a un flujo grabado. */
  predicate: Predicate;
};

/** Recorre el subárbol y devuelve, en orden de aparición, todos los nodos que satisfacen
 * el predicado. La deduplicación/ranking por relevancia es responsabilidad de una capa
 * superior (F1); esta función solo garantiza determinismo y exhaustividad. */
export function find(root: UINode, predicate: Predicate): FindMatch[] {
  const results: FindMatch[] = [];
  const stack: UINode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (matches(node, predicate)) {
      results.push({ node, predicate });
    }
    // Recorrido en orden: empujar hijos en reversa para desapilar en orden natural.
    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = node.children[i];
      if (child) stack.push(child);
    }
  }
  return results;
}
