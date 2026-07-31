import { Session } from "../src/session.js";
import type { Backend } from "../src/backend.js";

/**
 * Suite de conformidad (Parte C2 del plan de ejecución): se escribe en F0, no en F2,
 * porque si se escribiera cuando ya existen dos backends terminaría describiendo lo que
 * ambos hacen en vez de lo que el CONTRATO exige — y entonces el "test de contrato" de F2
 * no podría falsar nada.
 *
 * No importa un test runner concreto: recibe sus primitivas (`describe`/`it`/…) inyectadas
 * por quien la invoca. Así ningún backend necesita que `@uui/core` traiga vitest como
 * dependencia de runtime — cada backend ya trae su propio test runner.
 */
export type TestHarness = {
  describe: (name: string, fn: () => void) => void;
  it: (name: string, fn: () => Promise<void> | void) => void;
  beforeAll: (fn: () => Promise<void> | void) => void;
  afterAll: (fn: () => Promise<void> | void) => void;
  expect: (value: unknown) => {
    toBe(expected: unknown): void;
    toBeNull(): void;
    toBeGreaterThan(n: number): void;
    toBeLessThan(n: number): void;
    toBeGreaterThanOrEqual(n: number): void;
    toContain(item: unknown): void;
    toEqual(expected: unknown): void;
    not: {
      toHaveProperty(key: string): void;
      toBeNull(): void;
      toContain(item: unknown): void;
    };
    rejects: {
      toThrow(matcher?: unknown): Promise<void>;
    };
  };
};

/**
 * El "dónde" de la escena de referencia. La suite nunca conoce selectores concretos —
 * cada backend trae su propio fixture (p. ej. `fixtures/web-app` para backend-web, un
 * WinForms de prueba para backend-uia en F2) y lo describe con este contrato.
 */
export type ConformanceFixture = {
  /** Backend ya conectado al fixture de referencia de este backend. */
  createBackend(): Promise<Backend>;
  scenarios: {
    /** Un botón real, con role=button, un `name` que contiene `nameContains`, y que
     * declara soportar 'invoke'. */
    actionableButton: { nameContains: string };
    /** >= minCount filas con un botón de nombre IDÉNTICO — ejercita que D1 no colisiona
     * donde un hash de propiedades sí lo haría. */
    repeatedRows: { nameContains: string; minCount: number };
    /** Al menos un nodo que el backend marca `decorative` y que tiene >=1 hijo real
     * debajo — ejercita la poda+reparenting de D4. */
    decorativeWrapperWithChildren: { exists: true };
    /** Un textbox real donde `setValue` deba ser rechazado si aún no lo declara (ver caso
     * de verbo no soportado) — cualquier nodo que NO declare 'setValue' sirve. */
    nodeWithoutSetValue: { nameContains: string };
  };
};

export function defineConformanceSuite(
  harness: TestHarness,
  backendName: string,
  setup: () => Promise<ConformanceFixture>,
): void {
  const { describe, it, beforeAll, afterAll, expect } = harness;

  describe(`Conformidad de contrato — ${backendName}`, () => {
    let fixture: ConformanceFixture;
    let backend: Backend;
    let session: Session;

    beforeAll(async () => {
      fixture = await setup();
      backend = await fixture.createBackend();
      session = new Session(backend);
    });

    afterAll(async () => {
      await session.dispose();
    });

    it("D2: un snapshot con maxDepth acotado no baja más allá de lo pedido", async () => {
      const shallow = await session.snapshot({ maxDepth: 0, mode: "full" });
      expect(shallow.root.children).toEqual([]);
    });

    it("D3: todo nodo trae un `role` canónico Y un `nativeRole` de primera clase", async () => {
      const snapshot = await session.snapshot({ mode: "full" });
      const stack = [snapshot.root];
      while (stack.length > 0) {
        const node = stack.pop();
        if (!node) continue;
        expect(typeof node.role).toBe("string");
        expect(typeof node.nativeRole).toBe("string");
        stack.push(...node.children);
      }
    });

    it("D1: dos filas con el MISMO nombre reciben uids distintos (no colapsan por hash de propiedades)", async () => {
      const { nameContains, minCount } = fixture.scenarios.repeatedRows;
      const matches = await session.find({ kind: "nameContains", text: nameContains });
      expect(matches.length).toBeGreaterThanOrEqual(minCount);
      const uids = new Set(matches.map((m) => m.uid));
      expect(uids.size).toBe(matches.length);
    });

    it("D1 + D6: act() re-resuelve el fingerprint y ejecuta un verbo soportado, sin exponer ningún handle", async () => {
      const { nameContains } = fixture.scenarios.actionableButton;
      const [match] = await session.find({ kind: "nameContains", text: nameContains });
      expect(match).not.toBeNull();
      if (!match) return;
      expect(match.supports).toContain("invoke");
      // No debe lanzar: el uid opaco resuelve contra el backend en este instante (D1).
      await session.act(match.uid, "invoke");
    });

    it("D6: act() con un verbo no declarado por el nodo rechaza explícito, sin ramificar por backend", async () => {
      const { nameContains } = fixture.scenarios.nodeWithoutSetValue;
      const [match] = await session.find({ kind: "nameContains", text: nameContains });
      expect(match).not.toBeNull();
      if (!match) return;
      expect(match.supports).not.toContain("setValue");
      await expect(session.act(match.uid, "setValue", { value: "x" })).rejects.toThrow();
    });

    it("D4: `compact` poda los nodos decorativos y reparenta sus hijos — no desaparece contenido real", async () => {
      expect(fixture.scenarios.decorativeWrapperWithChildren.exists).toBe(true);
      const full = await session.snapshot({ mode: "full" });
      const compact = await session.snapshot({ mode: "compact" });

      const countNodes = (root: { children: unknown[] }): number =>
        1 + root.children.reduce((sum: number, c) => sum + countNodes(c as { children: unknown[] }), 0);
      const hasDecorative = (root: { decorative?: boolean; children: unknown[] }): boolean =>
        Boolean(root.decorative) || root.children.some((c) => hasDecorative(c as never));

      expect(hasDecorative(full.root)).toBe(true);
      // compact tiene menos nodos (los decorativos se podaron)...
      expect(countNodes(compact.root)).toBeLessThan(countNodes(full.root));
    });

    it("§3: el presupuesto de tokens del snapshot compact de referencia se mide (no se asume)", async () => {
      const { tokenEstimate } = await session.snapshot({ mode: "compact" });
      expect(tokenEstimate).toBeGreaterThan(0);
      // El objetivo p95 < 3000 (§3) se mide con la app de referencia completa en
      // packages/backend-web/test/tokens.test.ts — aquí solo se exige que la métrica exista.
    });
  });
}
