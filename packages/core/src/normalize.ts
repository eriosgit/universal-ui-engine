import type { UINode } from "./types.js";

export type NormalizedNode = { role: string; name: string | null; children: NormalizedNode[] };

/**
 * §6 (definición de terminado): los golden trees se comparan por FORMA NORMALIZADA
 * (roles + nombres + jerarquía), nunca por igualdad estricta. Los árboles de UI cambian
 * con la versión del SO, la resolución de pantalla y el tema — comparar por igualdad
 * estricta (bounds, uid, locators…) produciría CI roja permanente sin que nada real se
 * haya roto. Vive en el núcleo porque cualquier backend futuro necesita EXACTAMENTE esta
 * misma noción de "forma" para que sus propios golden trees sean comparables entre sí.
 */
export function normalizeShape(node: UINode): NormalizedNode {
  return { role: node.role, name: node.name, children: node.children.map(normalizeShape) };
}
