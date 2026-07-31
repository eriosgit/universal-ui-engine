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
  /**
   * Igualdad exacta del nombre accesible (normalizada: sin espacios sobrantes, sin
   * distinguir mayúsculas, y tolerando el `*` de "campo obligatorio" que muchas apps
   * pegan al label).
   *
   * Existe porque `nameContains` es peligrosamente impreciso en formularios reales: al
   * crear un ítem en un SaaS de facturación, `nameContains:"Nombre"` coincidió antes con
   * la caja "Buscar por nombre o referencia" que con el campo "Nombre*" del formulario —
   * y el agente terminó escribiendo en el buscador y enviando el formulario vacío. Para
   * ACTUAR sobre un campo concreto, la igualdad exacta es lo correcto; `nameContains`
   * queda para explorar.
   */
  | { kind: "nameEquals"; text: string }
  | { kind: "and"; all: Predicate[] };

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Quita el marcador de obligatoriedad para que `nameEquals("Nombre")` case con el label
 * real "Nombre*" — la diferencia es de presentación, no de identidad del campo. */
function normalizeName(text: string): string {
  return normalize(text).replace(/\s*\*+$/, "");
}

export function matches(node: UINode, predicate: Predicate): boolean {
  switch (predicate.kind) {
    case "role":
      return node.role === predicate.role;
    case "nameContains":
      return node.name !== null && normalize(node.name).includes(normalize(predicate.text));
    case "nameEquals":
      return node.name !== null && normalizeName(node.name) === normalizeName(predicate.text);
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
