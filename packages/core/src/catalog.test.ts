import { describe, expect, it } from "vitest";
import { buildCatalog, renderCatalogMarkdown } from "./catalog.js";
import { Session } from "./session.js";
import { createFakeBackend } from "./testing/fakeBackend.js";
import type { RawNode } from "./backend.js";
import type { Clock } from "./stability.js";
import type { Role, State, UINode } from "./types.js";

function nodo(partial: Partial<UINode> & Pick<UINode, "uid" | "role">): UINode {
  return {
    nativeRole: partial.role,
    name: null,
    automationId: null,
    description: null,
    options: null,
    value: undefined,
    states: new Set<State>(["enabled", "visible"]),
    bounds: null,
    decorative: false,
    supports: [],
    locators: [],
    children: [],
    backend: "fake",
    ...partial,
  };
}

const OPCIONES = { target: "https://app.test/login", scannedAt: "2026-07-31T00:00:00.000Z" };

describe("buildCatalog (ADR-0006)", () => {
  it("agrupa por contenedor y separa campos de acciones", () => {
    const arbol = nodo({
      uid: "1",
      role: "main" as Role,
      children: [
        nodo({
          uid: "2",
          role: "form" as Role,
          name: "Iniciar sesión",
          children: [
            nodo({ uid: "3", role: "textbox" as Role, name: "Correo" }),
            nodo({ uid: "4", role: "button" as Role, name: "Entrar" }),
          ],
        }),
      ],
    });

    const catalogo = buildCatalog(arbol, OPCIONES);

    expect(catalogo.groups).toHaveLength(1);
    expect(catalogo.groups[0]?.name).toBe("Iniciar sesión");
    expect(catalogo.groups[0]?.fields.map((f) => f.name)).toEqual(["Correo"]);
    expect(catalogo.groups[0]?.actions.map((a) => a.name)).toEqual(["Entrar"]);
  });

  it("recomienda el locator más confiable y deja el resto como respaldo", () => {
    const arbol = nodo({
      uid: "1",
      role: "textbox" as Role,
      name: "Correo",
      locators: [
        { kind: "css", value: "#app > input", confidence: 0.6 },
        { kind: "testId", value: "email", confidence: 0.95 },
        { kind: "attrName", value: "email", confidence: 0.85 },
      ],
    });

    const [grupo] = buildCatalog(arbol, OPCIONES).groups;
    const campo = grupo!.fields[0]!;

    expect(campo.selector).toEqual({ kind: "testId", value: "email", confidence: 0.95 });
    expect(campo.fallbacks.map((f) => f.kind)).toEqual(["attrName", "css"]);
    // `attrName` se expone además como columna propia: es lo que el dev busca en la tabla.
    expect(campo.attrName).toBe("email");
  });

  it("NUNCA recomienda coordenadas: no le sirven a nadie pegadas en un proyecto", () => {
    const arbol = nodo({
      uid: "1",
      role: "button" as Role,
      name: "Entrar",
      locators: [{ kind: "coords", value: "120,340", confidence: 0.05 }],
    });

    const accion = buildCatalog(arbol, OPCIONES).groups[0]!.actions[0]!;

    expect(accion.selector).toBeNull();
    expect(accion.fallbacks).toEqual([]);
  });

  it("refleja required/readonly/disabled y las opciones de un select", () => {
    const arbol = nodo({
      uid: "1",
      role: "combobox" as Role,
      name: "País",
      automationId: "country",
      options: ["Colombia", "México"],
      states: new Set<State>(["visible", "required"]),
    });

    const campo = buildCatalog(arbol, OPCIONES).groups[0]!.fields[0]!;

    expect(campo.required).toBe(true);
    // Sin `enabled` en states, el control está deshabilitado.
    expect(campo.disabled).toBe(true);
    expect(campo.options).toEqual(["Colombia", "México"]);
    expect(campo.automationId).toBe("country");
  });

  it("no funde dos formularios distintos sin nombre en un solo grupo", () => {
    const form = (uid: string, campo: string): UINode =>
      nodo({
        uid,
        role: "form" as Role,
        children: [nodo({ uid: `${uid}-a`, role: "textbox" as Role, name: campo })],
      });
    const arbol = nodo({
      uid: "0",
      role: "main" as Role,
      children: [form("1", "Buscar"), form("2", "Correo")],
    });

    expect(buildCatalog(arbol, OPCIONES).groups).toHaveLength(2);
  });

  it("descarta los contenedores que no aportan ningún campo ni acción", () => {
    const arbol = nodo({
      uid: "1",
      role: "form" as Role,
      name: "Envoltorio de maquetado",
      children: [nodo({ uid: "2", role: "generic" as Role })],
    });

    expect(buildCatalog(arbol, OPCIONES).groups).toEqual([]);
  });
});

describe("Session.catalog — espera a que la pantalla se asiente (ADR-0005)", () => {
  /** Reloj falso: los tests no esperan segundos reales. */
  function relojFalso(): Clock {
    let t = 0;
    return { now: () => t, sleep: async (ms) => void (t += ms) };
  }

  /** Árbol que gana un campo en cada sondeo hasta `etapas`, y luego se queda quieto. */
  function arbolQueCrece(etapas: number): () => RawNode {
    let n = 0;
    return () => {
      const campos = Array.from({ length: Math.min(n, etapas) }, (_, i) => ({
        ...nodo({ uid: `c${i}`, role: "textbox" as Role, name: `Campo ${i + 1}` }),
        children: [],
      }));
      n += 1;
      return {
        ...nodo({ uid: "f", role: "form" as Role, name: "Alta" }),
        children: campos,
      } as unknown as RawNode;
    };
  }

  it("captura DESPUÉS de que el árbol deje de crecer, no en la primera etapa", async () => {
    const session = new Session(createFakeBackend({ tree: arbolQueCrece(4) }));

    const catalogo = await session.catalog({
      target: "https://app.test",
      scannedAt: OPCIONES.scannedAt,
      clock: relojFalso(),
    });

    // Sin la espera se habría capturado con 0 o 1 campos: un catálogo corto con toda la
    // apariencia de estar completo. Es el fallo medido contra una app real (960 vs 207).
    expect(catalogo.groups[0]?.fields).toHaveLength(4);
  });

  it("`stabilize: false` captura de inmediato — para páginas estáticas", async () => {
    const session = new Session(createFakeBackend({ tree: arbolQueCrece(4) }));

    const catalogo = await session.catalog({
      target: "https://app.test",
      scannedAt: OPCIONES.scannedAt,
      stabilize: false,
      clock: relojFalso(),
    });

    expect(catalogo.groups[0]?.fields.length ?? 0).toBeLessThan(4);
  });

  it("si el árbol nunca se aquieta, captura el último estado en vez de fallar", async () => {
    // Una animación perpetua o un reloj visible no deben impedir que salga un catálogo.
    const session = new Session(createFakeBackend({ tree: arbolQueCrece(Number.MAX_SAFE_INTEGER) }));

    const catalogo = await session.catalog({
      target: "https://app.test",
      scannedAt: OPCIONES.scannedAt,
      stabilize: { quietMs: 500, timeoutMs: 2000 },
      clock: relojFalso(),
    });

    expect(catalogo.groups.length).toBeGreaterThan(0);
  });
});

describe("colapso de repeticiones (una tabla no debe escupir 20 filas idénticas)", () => {
  /** Tabla de `filas` filas, cada una con un botón "Editar" y su ruta CSS por índice. */
  function tabla(filas: number): UINode {
    return nodo({
      uid: "t",
      role: "table" as Role,
      children: Array.from({ length: filas }, (_, i) =>
        nodo({
          uid: `b${i}`,
          role: "button" as Role,
          name: "Editar",
          locators: [
            {
              kind: "css",
              value: `table > tbody > tr:nth-child(${i + 1}) > td:nth-child(2) > button`,
              confidence: 0.6,
            },
          ],
        }),
      ),
    });
  }

  it("colapsa 20 botones idénticos en UNA entrada, con el conteo a la vista", () => {
    const acciones = buildCatalog(tabla(20), OPCIONES).groups[0]!.actions;

    expect(acciones).toHaveLength(1);
    expect(acciones[0]?.occurrences).toBe(20);
  });

  it("parametriza el índice variable con {n}, incluso cruzando de 9 a 10 dígitos", () => {
    // El caso que rompe un prefijo común ingenuo: `…(1)` y `…(11)` comparten ese `1`.
    const acciones = buildCatalog(tabla(20), OPCIONES).groups[0]!.actions;

    expect(acciones[0]?.patternSelector).toBe(
      "table > tbody > tr:nth-child({n}) > td:nth-child(2) > button",
    );
  });

  it("no colapsa elementos que solo comparten el rol", () => {
    const arbol = nodo({
      uid: "1",
      role: "form" as Role,
      children: [
        nodo({ uid: "2", role: "button" as Role, name: "Guardar" }),
        nodo({ uid: "3", role: "button" as Role, name: "Cancelar" }),
      ],
    });

    expect(buildCatalog(arbol, OPCIONES).groups[0]!.actions).toHaveLength(2);
  });

  it("NO colapsa si no hay patrón común: el selector del primero no sirve para el resto", () => {
    const arbol = nodo({
      uid: "1",
      role: "form" as Role,
      children: [
        nodo({
          uid: "2",
          role: "button" as Role,
          name: "Ver",
          locators: [{ kind: "testId", value: "ver-alfa", confidence: 0.95 }],
        }),
        nodo({
          uid: "3",
          role: "button" as Role,
          name: "Ver",
          locators: [{ kind: "testId", value: "ver-omega", confidence: 0.95 }],
        }),
      ],
    });

    const acciones = buildCatalog(arbol, OPCIONES).groups[0]!.actions;

    // Dos filas, cada una con SU selector: el desarrollador necesita los dos.
    expect(acciones).toHaveLength(2);
    expect(acciones.map((a) => a.selector?.value)).toEqual(["ver-alfa", "ver-omega"]);
  });

  it("NO colapsa elementos sin nombre: no hay evidencia de que sean el mismo control", () => {
    // Caso real (menú lateral de una app de facturación): 24 links distintos, ninguno con
    // nombre accesible. Colapsarlos daba una fila "— ×24" que ocultaba 23 elementos.
    const arbol = nodo({
      uid: "1",
      role: "navigation" as Role,
      children: [1, 2, 3].map((i) =>
        nodo({
          uid: `l${i}`,
          role: "link" as Role,
          name: null,
          locators: [{ kind: "css", value: `nav > a.distinta-${i * 7}`, confidence: 0.6 }],
        }),
      ),
    });

    expect(buildCatalog(arbol, OPCIONES).groups[0]!.actions).toHaveLength(3);
  });

  it("el resumen ocupa el sitio de la PRIMERA aparición, sin reordenar lo demás", () => {
    const conCss = (uid: string, name: string, i: number): UINode =>
      nodo({
        uid,
        role: "button" as Role,
        name,
        locators: [{ kind: "css", value: `ul > li:nth-child(${i}) > button`, confidence: 0.6 }],
      });
    const arbol = nodo({
      uid: "1",
      role: "form" as Role,
      children: [conCss("2", "Editar", 1), conCss("3", "Total", 9), conCss("4", "Editar", 2)],
    });

    const acciones = buildCatalog(arbol, OPCIONES).groups[0]!.actions;

    expect(acciones.map((a) => a.name)).toEqual(["Editar", "Total"]);
    expect(acciones[0]?.occurrences).toBe(2);
  });

  it("no reordena cuando NO colapsa: el catálogo se lee en el orden de la pantalla", () => {
    // Sin locators no hay patrón, así que no se colapsa nada — y entonces las tres
    // entradas deben salir tal cual aparecen, no agrupadas por nombre.
    const arbol = nodo({
      uid: "1",
      role: "form" as Role,
      children: [
        nodo({ uid: "2", role: "button" as Role, name: "Primero" }),
        nodo({ uid: "3", role: "button" as Role, name: "Segundo" }),
        nodo({ uid: "4", role: "button" as Role, name: "Primero" }),
      ],
    });

    expect(buildCatalog(arbol, OPCIONES).groups[0]!.actions.map((a) => a.name)).toEqual([
      "Primero",
      "Segundo",
      "Primero",
    ]);
  });
});

describe("renderCatalogMarkdown", () => {
  it("marca la fila colapsada con ×N y muestra el patrón, no el selector de la fila 1", () => {
    const arbol = nodo({
      uid: "t",
      role: "table" as Role,
      children: [1, 2, 3].map((i) =>
        nodo({
          uid: `b${i}`,
          role: "button" as Role,
          name: "Editar",
          locators: [{ kind: "css", value: `tr:nth-child(${i}) > button`, confidence: 0.6 }],
        }),
      ),
    });

    const md = renderCatalogMarkdown(buildCatalog(arbol, OPCIONES));

    expect(md).toContain("Editar ×3");
    expect(md).toContain("tr:nth-child({n}) > button");
    expect(md).toContain("3 elementos");
  });

  it("escapa las barras verticales, que romperían la tabla", () => {
    const arbol = nodo({
      uid: "1",
      role: "textbox" as Role,
      name: "Alto | Ancho",
      locators: [{ kind: "testId", value: "dim", confidence: 0.95 }],
    });

    const md = renderCatalogMarkdown(buildCatalog(arbol, OPCIONES));

    expect(md).toContain("Alto \\| Ancho");
  });

  it("no filtra el separador NUL interno del locator role+name a la salida", () => {
    // El backend separa rol y nombre con un NUL: inequívoco mientras no salga del motor.
    // En un JSON que lee un humano es un carácter de control, y se serializa como \u0000.
    const arbol = nodo({
      uid: "1",
      role: "button" as Role,
      name: "Entrar",
      locators: [
        { kind: "role+name", value: `button${String.fromCharCode(0)}Entrar`, confidence: 0.8 },
      ],
    });

    const accion = buildCatalog(arbol, OPCIONES).groups[0]!.actions[0]!;

    expect(accion.selector?.value).toBe('button "Entrar"');
    expect(JSON.stringify(accion)).not.toContain("\\u0000");
  });

  it("lleva SIEMPRE la fecha: un catálogo sin fecha miente sobre su vigencia", () => {
    const md = renderCatalogMarkdown(buildCatalog(nodo({ uid: "1", role: "main" as Role }), OPCIONES));
    expect(md).toContain("2026-07-31T00:00:00.000Z");
  });
});
