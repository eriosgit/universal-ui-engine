import type { Backend, BackendRegion, RawNode } from "./backend.js";
import { performVerb, type ActResult } from "./actions.js";
import { find as findInTree, type Predicate } from "./find.js";
import { resolveFingerprint } from "./resolver.js";
import { serialize, signatureOf, stripInternalFields } from "./serialize.js";
import type {
  ActionArgs,
  Fingerprint,
  Region,
  Snapshot,
  SnapshotOptions,
  UINode,
  Verb,
} from "./types.js";

type SessionEntry = { fingerprint: Fingerprint; supports: Verb[] };

/**
 * La única pieza de estado del núcleo: el registro uid opaco → fingerprint (D1).
 * Deliberadamente NO guarda ningún handle vivo del backend — solo lo necesario para
 * volver a pedirle al backend "resuelve esto" en el momento de actuar.
 *
 * Una `Session` se corresponde 1:1 con una conexión a un backend concreto (una página
 * de Playwright, una ventana UIA…). El adaptador MCP/CLI decide cuántas sesiones abrir.
 */
export class Session {
  /** Expuesto para el ejecutor de flujos (`runFlow`), que necesita `navigate()` — la
   * única capacidad del backend que no pasa por un nodo del árbol. */
  get backend(): Backend {
    return this.backendRef;
  }
  private readonly nodes = new Map<string, SessionEntry>();
  private counter = 0;
  /** Firmas de nodos hoja ya enviadas al consumidor en snapshots anteriores. Es lo que
   * permite reconocer el cromo persistente (menú, cabecera) y dejar de repagarlo en cada
   * pantalla — ver `collapseSeenChrome` en serialize.ts (ADR-0003). */
  private readonly seenSignatures = new Set<string>();

  constructor(private readonly backendRef: Backend) {}

  private mintUid(): string {
    this.counter += 1;
    return `${this.backendRef.id}:${this.counter}`;
  }

  /** Asigna uid + registra fingerprint/supports para cada nodo del árbol crudo. La ruta
   * estructural (`path`) es la secuencia de índices entre TODOS los hijos crudos —
   * incluidos los decorativos — porque es la que reflejaría la posición en el árbol
   * nativo si algún backend futuro necesitara resolver por estructura (D1, último
   * recurso; no usado por backend-web en F0). */
  private register(raw: RawNode, path: number[]): UINode {
    const uid = this.mintUid();
    this.nodes.set(uid, {
      // Un backend real siempre puebla `locators` — solo llega vacío aquí si el
      // consumidor construyó un RawNode a mano sin ellos (p. ej. una prueba).
      fingerprint: { locators: raw.locators ?? [], path },
      supports: raw.supports,
    });
    return {
      ...raw,
      uid,
      children: raw.children.map((child, index) => this.register(child, [...path, index])),
    };
  }

  /**
   * D2: traduce la `Region` PÚBLICA (donde `root`, si viene, es un uid de sesión — algo
   * que el backend nunca ha visto) a la `BackendRegion` que el backend sí entiende,
   * re-resolviendo ese uid a un `Locator` vivo (D1) antes de delegarle nada. Así el
   * backend nunca necesita saber qué es un "uid de sesión".
   */
  private async resolveRegion(region: Region): Promise<BackendRegion> {
    if (region.root === undefined) {
      return { maxDepth: region.maxDepth, filter: region.filter };
    }
    const entry = this.nodes.get(region.root);
    if (!entry) {
      throw new Error(
        `uid desconocido en esta sesión: '${region.root}' (region.root). Los uid son ` +
          "opacos y de sesión (D1) — no sobreviven a un snapshot de otra sesión.",
      );
    }
    const resolution = await resolveFingerprint(this.backend, entry.fingerprint);
    if (!resolution.resolved) {
      throw new Error(
        `No se pudo re-anclar la región en uid '${region.root}': ningún locator del ` +
          `fingerprint resolvió tras ${resolution.attempts.length} intento(s).`,
      );
    }
    return { root: resolution.locator, maxDepth: region.maxDepth, filter: region.filter };
  }

  async snapshot(options: SnapshotOptions = {}): Promise<Snapshot> {
    const { mode = "compact", ...region } = options;
    const backendRegion = await this.resolveRegion(region);
    const raw = await this.backendRef.query(backendRegion);
    const root = this.register(raw, []);
    const { root: serialized, tokenEstimate } = serialize(root, mode, this.seenSignatures);
    // Registrar DESPUÉS de serializar, y sobre el árbol SERIALIZADO, no el crudo: "ya lo
    // envié" solo tiene sentido medido sobre lo que de verdad se envió. (En el árbol
    // crudo un link suele tener hijos —iconos, spans— así que no sería hoja y nunca se
    // registraría; en el serializado, tras colapsar envoltorios, sí lo es.)
    this.rememberSignatures(serialized);
    return { root: serialized, mode, tokenEstimate };
  }

  private rememberSignatures(node: UINode): void {
    // Un nodo ya resumido no se re-registra: su firma es la del resumen, no la de un
    // elemento real de la pantalla.
    if (node.collapsed) return;
    if (node.children.length === 0) {
      this.seenSignatures.add(signatureOf(node));
    }
    node.children.forEach((child) => this.rememberSignatures(child));
  }

  /**
   * D7: `find` consulta una región (por defecto toda la sesión) y aplica un predicado
   * determinista. No hay capa semántica todavía (F1) — este es el `find` "de verdad" que
   * cualquier ranking semántico futuro deberá seguir usando por debajo.
   *
   * El árbol se busca COMPLETO (sin podar decorativos — un predicado podría legítimamente
   * querer matchear sobre ellos), pero cada match que se devuelve pasa por
   * `stripInternalFields`: igual que `snapshot()`, `find()` nunca expone `raw` ni
   * `locators` — sería tan violación de la opacidad de D1 aquí como en un snapshot.
   */
  async find(predicate: Predicate, region: Region = {}): Promise<UINode[]> {
    const backendRegion = await this.resolveRegion(region);
    const raw = await this.backendRef.query(backendRegion);
    const root = this.register(raw, []);
    return findInTree(root, predicate).map((match) => stripInternalFields(match.node));
  }

  /**
   * D1 + D6: re-resuelve el fingerprint del uid (nunca reusa un handle) y compone el
   * verbo solo si el nodo lo declaró soportado.
   *
   * Limitación conocida de F0 (no de F1): `supports` es el capturado en el snapshot que
   * emitió el uid, no una relectura en vivo — si el nodo cambió de capacidades entre el
   * snapshot y la acción, `act` puede rechazar (o aceptar) con información desactualizada.
   * Cerrar esa ventana con una relectura de `supports` en cada `act` es trabajo de F1
   * (va de la mano con "observador de cambios").
   */
  async act(uid: string, verb: Verb, args?: ActionArgs): Promise<ActResult> {
    const entry = this.nodes.get(uid);
    if (!entry) {
      throw new Error(
        `uid desconocido en esta sesión: '${uid}'. Los uid son opacos y de sesión (D1) — ` +
          "no sobreviven a un snapshot de otra sesión ni se pueden inventar.",
      );
    }
    return performVerb(
      this.backend,
      { supports: entry.supports, fingerprint: entry.fingerprint },
      verb,
      args,
    );
  }

  async dispose(): Promise<void> {
    await this.backendRef.dispose();
  }
}
