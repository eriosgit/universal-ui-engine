import { ROLES, type Role } from "./types.js";

const ROLE_SET = new Set<string>(ROLES);

/**
 * Normaliza un rol ARIA computado (o cualquier vocabulario suficientemente parecido) al
 * enum canónico y cerrado (D3). Vive en el núcleo porque es genuinamente compartible —
 * cualquier backend cuyo vocabulario nativo ya sea (o se acerque a) ARIA puede reusarla
 * (web hoy; Electron/CDP mañana) — pero es una utilidad pura, no una dependencia de
 * ningún backend concreto.
 *
 * Un rol nativo sin equivalente cae en 'generic': sigue siendo un control real y
 * potencialmente interactivo, simplemente sin mapeo canónico (no confundir con
 * `decorative`, que es un juicio del backend sobre si el nodo es andamiaje — D4).
 */
export function normalizeAriaRole(nativeRole: string): Role {
  const key = nativeRole.trim().toLowerCase();
  if (ROLE_SET.has(key)) return key as Role;
  return "generic";
}
