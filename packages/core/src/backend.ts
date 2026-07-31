import type { ActionArgs, BackendId, Locator, Region, UINode, Verb } from "./types.js";

/**
 * Un nodo tal como lo entrega el backend: todo lo de UINode excepto `uid` y con
 * `children` recursivamente del mismo tipo. El `uid` opaco lo asigna el núcleo al
 * registrar el fingerprint en la sesión (ver session.ts) — el backend no sabe qué es
 * un "uid de sesión", solo describe lo que ve.
 */
export type RawNode = Omit<UINode, "uid" | "children"> & { children: RawNode[] };

/**
 * La versión de `Region` que de verdad recibe un backend. El `root` público (expuesto a
 * MCP/CLI/agente) es un `uid` de sesión — algo que el backend nunca ha visto y no puede
 * interpretar. `Session` resuelve ese uid a un `Locator` vivo (vía el resolver, D1) ANTES
 * de llamar a `query`, así que el backend solo necesita saber anclar una consulta a un
 * locator concreto, nunca a un uid opaco.
 */
export type BackendRegion = {
  root?: Locator;
  maxDepth?: number;
  filter?: Region["filter"];
};

/**
 * Contrato core↔Backend (ADR-0002). Esta es la superficie completa que un backend nuevo
 * debe implementar — y la única razón para tocar `packages/core` al agregar uno es que
 * este contrato resulte insuficiente (§5.5: esa decisión no se delega).
 */
export interface Backend {
  readonly id: BackendId;

  /**
   * D2: nunca "el árbol completo". Siempre una región acotada (root + maxDepth + filter).
   * Web puede resolverla con un único `evaluate`; UIA con un solo `CacheRequest` de FlaUI.
   * La asimetría de costo entre backends no debe filtrarse fuera de esta función.
   */
  query(region: BackendRegion): Promise<RawNode>;

  /**
   * D1 — única primitiva de re-resolución que un backend debe implementar. Devuelve
   * `true` si, EN ESTE INSTANTE, el locator resuelve a exactamente un elemento vivo.
   * El orden de intento (degradación testId → role+name → css → xpath → coords) es
   * responsabilidad del núcleo (ver resolver.ts), no del backend.
   */
  probeLocator(locator: Locator): Promise<boolean>;

  /**
   * Ejecuta `verb` sobre el elemento apuntado por `locator` — que ya fue validado por
   * el resolver del núcleo. El backend NO decide si el verbo es válido para el nodo;
   * eso ya lo comprobó `actions.ts` contra `node.supports` (D6) antes de llamar aquí.
   */
  performAt(locator: Locator, verb: Verb, args?: ActionArgs): Promise<void>;

  /**
   * Lleva al backend hasta un destino nombrado. OPCIONAL, porque no toda tecnología de
   * UI tiene el concepto: en Web es `page.goto(url)`; en UIA (F2) sería lanzar o enfocar
   * una aplicación por su ejecutable/ventana; en SAP, abrir una transacción.
   *
   * Un flujo grabado (F3) casi siempre empieza aquí, y por eso vive en el contrato en vez
   * de en el adaptador: un flujo debe poder decir "ve a X" sin saber qué backend lo va a
   * ejecutar. Un backend que no lo implemente simplemente no admite flujos con `goto`.
   */
  navigate?(target: string): Promise<void>;

  /** Libera recursos nativos (páginas, sesiones COM, procesos sidecar…). */
  dispose(): Promise<void>;
}
