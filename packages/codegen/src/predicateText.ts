import type { Predicate } from "@uui/core";

/**
 * Un predicado de `@uui/core` es un árbol de condiciones sobre el MODELO (rol + nombre
 * accesible). Para generar código autónomo hay que traducirlo al lenguaje de localización
 * del target — y ahí está el valor: Playwright ya tiene `getByRole(role, {name})`, que es
 * casi 1:1 con nuestro modelo, así que el script generado NO depende de @uui en runtime.
 */

export type FlatPredicate = {
  role?: string;
  nameEquals?: string;
  nameContains?: string;
};

/** Aplana un predicado (posiblemente compuesto con `and`) a los campos que un localizador
 * del target puede expresar. Lanza si el predicado usa una forma que el target no sabe
 * representar — mejor fallar al generar que emitir un script que localiza otra cosa. */
export function flatten(predicate: Predicate): FlatPredicate {
  const out: FlatPredicate = {};
  const visit = (p: Predicate): void => {
    switch (p.kind) {
      case "role":
        out.role = p.role;
        break;
      case "nameEquals":
        out.nameEquals = p.text;
        break;
      case "nameContains":
        out.nameContains = p.text;
        break;
      case "and":
        p.all.forEach(visit);
        break;
    }
  };
  visit(predicate);
  if (!out.role && !out.nameEquals && !out.nameContains) {
    throw new Error("Predicado vacío: no se puede generar un localizador a partir de él.");
  }
  return out;
}

/** Descripción legible para comentarios y mensajes de aserción del código generado. */
export function describePredicate(predicate: Predicate): string {
  const f = flatten(predicate);
  const partes: string[] = [];
  if (f.role) partes.push(`role=${f.role}`);
  if (f.nameEquals) partes.push(`nombre="${f.nameEquals}"`);
  if (f.nameContains) partes.push(`nombre contiene "${f.nameContains}"`);
  return partes.join(", ");
}

export function quoteJs(text: string): string {
  return JSON.stringify(text);
}

export function quotePy(text: string): string {
  return JSON.stringify(text);
}
