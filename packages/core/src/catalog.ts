import type { Locator, Role, UINode } from "./types.js";

/**
 * ADR-0006 — El catálogo: la superficie que SÍ entrega selectores.
 *
 * `snapshot()` y `find()` siguen siendo opacos (D1): quien quiera ACTUAR pasa por un
 * `uid` que se re-resuelve. El catálogo es lo contrario y a propósito — es un documento
 * de LECTURA, fechado, para que un desarrollador se lleve los selectores a su proyecto.
 *
 * Reportar no es actuar. Esa es toda la distinción, y por eso vive en un módulo aparte
 * en vez de en un flag de `snapshot()`.
 */

/** El separador que usa el backend dentro de un locator `role+name`. Se declara con
 * `fromCharCode` a proposito: un NUL literal en el fuente es invisible en el editor,
 * rompe `grep` y hace que Git trate el archivo como binario. */
const SEPARADOR_ROLE_NAME = String.fromCharCode(0);

/** Nunca entra al catálogo: un selector por coordenadas no le sirve a nadie pegado en un
 * proyecto, y ofrecerlo daría una falsa sensación de que hay dónde agarrarse. */
const KIND_INUTIL_PARA_UN_HUMANO = "coords";

/** Roles que agrupan: un catálogo plano de 80 campos no lo lee nadie. */
const ROLES_CONTENEDOR: ReadonlySet<Role> = new Set([
  "form",
  "dialog",
  "region",
  "main",
  "navigation",
  "article",
  "table",
  // `grid` es lo que usan las tablas de datos reales (AG-Grid, PrimeReact DataTable).
  // Sin él, sus botones caían en el grupo del ancestro, mezclados con lo demás.
  "grid",
  "toolbar",
  "tablist",
  "complementary",
  "banner",
  "contentinfo",
] as Role[]);

/** Roles que son un CAMPO (el usuario introduce o elige algo). */
const ROLES_CAMPO: ReadonlySet<Role> = new Set([
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "checkbox",
  "radio",
  "slider",
  "spinbutton",
  // `switch` es el toggle estándar de cualquier UI moderna y el motor le da el verbo
  // `toggle`; omitirlo dejaba fuera un control que el usuario SÍ tiene que rellenar.
  "switch",
] as Role[]);

/** Roles sobre los que se ACTÚA (disparan algo). */
const ROLES_ACCION: ReadonlySet<Role> = new Set([
  "button",
  "link",
  "tab",
  "menuitem",
  "option",
  "treeitem",
] as Role[]);

export type CatalogSelector = {
  kind: Locator["kind"];
  value: string;
  confidence: number;
};

export type CatalogEntry = {
  /** El nombre por el que un humano llama a esto en la pantalla. */
  name: string | null;
  role: Role;
  nativeRole: string;
  /** `id` en web, `AutomationId` en escritorio. */
  automationId: string | null;
  /** Atributo `name` del campo, si lo tiene y es único. */
  attrName: string | null;
  description: string | null;
  options: string[] | null;
  value: string | null;
  required: boolean;
  readonly: boolean;
  disabled: boolean;
  /** El mejor selector disponible. `null` solo si el nodo no tenía ninguno utilizable. */
  selector: CatalogSelector | null;
  /** El resto, por si el recomendado no encaja en la herramienta de destino. */
  fallbacks: CatalogSelector[];
  /**
   * Cuántos elementos idénticos (mismo nombre y rol) resume esta entrada. `1` es el caso
   * normal. Una tabla de 20 filas con un botón "Editar" da UNA entrada con
   * `occurrences: 20` en vez de 20 entradas — pero el número queda a la vista: colapsar
   * en silencio haría que el catálogo pareciera decir que solo hay uno.
   */
  occurrences: number;
  /**
   * El selector de las repeticiones con el índice variable sustituido por `{n}`, cuando
   * todas difieren SOLO en un número (el caso de una fila de tabla). `null` si no hay un
   * patrón común — entonces `selector` sigue siendo el del primer elemento, concreto y
   * usable, y quien necesite el resto tiene el `occurrences` para saber que los hay.
   */
  patternSelector: string | null;
};

export type CatalogGroup = {
  /** Nombre del contenedor (el `<form>`, el diálogo, la región). `null` si es el resto. */
  name: string | null;
  role: Role | null;
  fields: CatalogEntry[];
  actions: CatalogEntry[];
};

export type Catalog = {
  /** De dónde salió: URL en web, app/ventana en escritorio. */
  target: string;
  /** ISO 8601. Un catálogo sin fecha miente: los selectores caducan. */
  scannedAt: string;
  groups: CatalogGroup[];
  /** Cuántos nodos se examinaron, para saber si el escaneo fue parcial. */
  nodesScanned: number;
  /**
   * Nodos que declaraban soportar algún verbo pero cuyo rol no entra en ninguna de las
   * tres listas de arriba. Se cuenta y se muestra a propósito: un catálogo que descarta
   * en silencio le hace creer al desarrollador que ha visto toda la pantalla. Si este
   * número no es 0, falta un rol por clasificar.
   */
  interactiveSkipped: number;
  /** Qué roles fueron, y cuántos de cada uno: un conteo a secas no dice si falta
   * clasificar un rol nuevo o si son `generic` (controles sin rol canónico, esperados). */
  interactiveSkippedByRole: Record<string, number>;
};

/**
 * El locator `role+name` usa un byte NUL como separador: interno, inequívoco y perfecto
 * mientras no salga del motor. Pero el catálogo lo lee un humano y lo parsea su script,
 * y un carácter de control en una salida de texto es un defecto — se serializa como
 * `\u0000` en JSON y no se ve en una terminal. Se presenta legible, sin tocar el
 * separador interno del que depende `resolveLocator`.
 */
function valorLegible(locator: Locator): string {
  if (locator.kind !== "role+name") return locator.value;
  const [role, name] = locator.value.split(SEPARADOR_ROLE_NAME);
  return name ? `${role} "${name}"` : (role ?? locator.value);
}

function toSelector(locator: Locator): CatalogSelector {
  return { kind: locator.kind, value: valorLegible(locator), confidence: locator.confidence };
}

function entryFor(node: UINode): CatalogEntry {
  const utiles = (node.locators ?? [])
    .filter((locator) => locator.kind !== KIND_INUTIL_PARA_UN_HUMANO)
    .slice()
    .sort((a, b) => b.confidence - a.confidence);

  return {
    name: node.name,
    role: node.role,
    nativeRole: node.nativeRole,
    automationId: node.automationId,
    attrName: utiles.find((locator) => locator.kind === "attrName")?.value ?? null,
    description: node.description,
    options: node.options,
    value: node.value ?? null,
    required: node.states.has("required"),
    readonly: node.states.has("readonly"),
    disabled: !node.states.has("enabled"),
    selector: utiles[0] ? toSelector(utiles[0]) : null,
    fallbacks: utiles.slice(1).map(toSelector),
    occurrences: 1,
    patternSelector: null,
  };
}

/**
 * Sustituye por `{n}` el trozo que varía entre selectores hermanos, si y solo si en TODOS
 * es un número. Es lo que convierte 20 rutas CSS de 200 caracteres en un patrón legible.
 *
 * El detalle que hace falta acertar: el prefijo común de `…tr:nth-child(1)` y
 * `…tr:nth-child(11)` incluye ese primer `1`, así que hay que retroceder mientras el
 * borde caiga sobre un dígito. Sin eso, la parte variable de la fila 11 sería `1` y la de
 * la fila 1 quedaría vacía — y el patrón saldría mal.
 */
function patronDe(valores: string[]): string | null {
  const [primero, ...resto] = valores;
  if (!primero || resto.length === 0) return null;
  if (resto.some((valor) => valor.length === 0)) return null;

  let pre = 0;
  while (pre < primero.length && resto.every((valor) => valor[pre] === primero[pre])) pre += 1;
  while (pre > 0 && /\d/.test(primero[pre - 1] ?? "")) pre -= 1;

  let suf = 0;
  const enSufijo = (valor: string): string | undefined => valor[valor.length - 1 - suf];
  while (
    suf < primero.length - pre &&
    resto.every((valor) => valor.length - 1 - suf >= 0 && enSufijo(valor) === enSufijo(primero))
  ) {
    suf += 1;
  }
  while (suf > 0 && /\d/.test(primero[primero.length - suf] ?? "")) suf -= 1;

  const medios = valores.map((valor) => valor.slice(pre, valor.length - suf));
  if (medios.some((medio) => !/^\d+$/.test(medio))) return null;

  // Que sean números NO basta: tienen que ser un ÍNDICE. Con ids de negocio
  // (`qty_10432`, `qty_99871`, `qty_40016`) el prefijo común también produce un patrón
  // —`qty_{n}`— y sería MENTIRA: `qty_1` no existe en la página, y los otros dos ids
  // desaparecerían del catálogo. Se exige que formen un rango contiguo sin repeticiones,
  // que es lo que produce una lista o una tabla renderizada por índice.
  const numeros = medios.map(Number);
  if (new Set(numeros).size !== numeros.length) return null;
  const ordenados = [...numeros].sort((a, b) => a - b);
  const contiguos = ordenados.every((n, i) => i === 0 || n === ordenados[i - 1]! + 1);
  if (!contiguos) return null;

  return `${primero.slice(0, pre)}{n}${suf > 0 ? primero.slice(primero.length - suf) : ""}`;
}

/**
 * Colapsa las entradas repetidas (mismo nombre y rol) en una sola. Sin esto, una tabla de
 * 20 filas escupe 20 filas idénticas en el catálogo, cada una con una ruta CSS enorme, y
 * el documento deja de ser legible justo donde más datos hay.
 *
 * Conserva el orden de primera aparición: el catálogo debe leerse en el orden de la
 * pantalla, no en el que la agrupación resulte más cómoda.
 */
function colapsarRepetidas(entradas: CatalogEntry[]): CatalogEntry[] {
  const claveDe = (entrada: CatalogEntry): string =>
    `${entrada.role}|${entrada.nativeRole}|${entrada.name ?? ""}`;

  const porClave = new Map<string, CatalogEntry[]>();
  for (const entrada of entradas) {
    const clave = claveDe(entrada);
    porClave.set(clave, [...(porClave.get(clave) ?? []), entrada]);
  }

  /** Solo se colapsa una clave si el resumen resultante es HONESTO y ÚTIL. */
  const colapsado = new Map<string, CatalogEntry>();
  for (const [clave, grupo] of porClave) {
    const primera = grupo[0]!;
    if (grupo.length === 1) continue;

    // Sin NOMBRE no hay ninguna evidencia de que sean el mismo control repetido. Medido
    // contra una app real: 24 links distintos de un menú lateral, ninguno con nombre
    // accesible, se fundían en una sola fila "— ×24". Eso no resume: oculta.
    if (primera.name === null) continue;

    // Todas las repeticiones deben localizarse del MISMO modo. Si la primera trae un
    // `testId` y la segunda un `attrName`, el patrón se etiquetaría con el kind del
    // primero y afirmaría que existe un `[data-testid=ver-2]` que en realidad es un
    // `[name=ver-2]`. `patronDe` solo ve strings, así que no puede detectarlo.
    const kinds = new Set(grupo.map((entrada) => entrada.selector?.kind));
    if (kinds.size !== 1 || kinds.has(undefined)) continue;

    const valores = grupo
      .map((entrada) => entrada.selector?.value)
      .filter((valor): valor is string => typeof valor === "string");
    const patron = valores.length === grupo.length ? patronDe(valores) : null;

    // Sin PATRÓN común tampoco: la fila mostraría el selector del primero como si
    // sirviera para los demás, y no sirve. Dos "Notas débito" con selectores distintos
    // son dos filas — el desarrollador necesita ambos.
    if (patron === null) continue;

    colapsado.set(clave, { ...primera, occurrences: grupo.length, patternSelector: patron });
  }

  // Se recorre en el ORDEN ORIGINAL, no por grupos: el catálogo debe leerse en el orden de
  // la pantalla. Agrupar primero y volcar después movería de sitio las entradas que NO se
  // colapsan, que es la mayoría.
  const yaEmitida = new Set<string>();
  const salida: CatalogEntry[] = [];
  for (const entrada of entradas) {
    const clave = claveDe(entrada);
    const resumen = colapsado.get(clave);
    if (!resumen) {
      salida.push(entrada);
      continue;
    }
    if (yaEmitida.has(clave)) continue;
    yaEmitida.add(clave);
    salida.push(resumen);
  }
  return salida;
}

/**
 * Construye el catálogo agrupando por el contenedor más cercano. El árbol se recorre
 * ENTERO: a diferencia de un snapshot, aquí no se poda nada por presupuesto — el
 * consumidor es un desarrollador que quiere todo, no un modelo con un límite de tokens
 * (ADR-0006; el gate de §3 sigue midiendo solo snapshots).
 */
export function buildCatalog(
  root: UINode,
  options: { target: string; scannedAt: string },
): Catalog {
  const groups = new Map<string, CatalogGroup>();
  let nodesScanned = 0;
  let interactiveSkipped = 0;
  const interactiveSkippedByRole: Record<string, number> = {};

  // Clave estable por contenedor: el índice va SIEMPRE, tenga nombre o no. Con el nombre
  // como clave, dos `role="dialog" aria-label="Confirmar"` distintos se fundían en un
  // solo grupo con los campos de ambos entremezclados — el mismo defecto que esta clave
  // pretendía evitar, solo que en la rama de los que SÍ tienen nombre.
  const claveDe = (contenedor: UINode | null, indice: number): string =>
    contenedor ? `${contenedor.role}:#${indice}:${contenedor.name ?? ""}` : "";

  function grupoDe(contenedor: UINode | null, indice: number): CatalogGroup {
    const clave = claveDe(contenedor, indice);
    let grupo = groups.get(clave);
    if (!grupo) {
      grupo = {
        name: contenedor?.name ?? null,
        role: contenedor?.role ?? null,
        fields: [],
        actions: [],
      };
      groups.set(clave, grupo);
    }
    return grupo;
  }

  let contadorContenedores = 0;

  function walk(node: UINode, contenedor: UINode | null, indiceContenedor: number): void {
    nodesScanned += 1;

    const esContenedor = ROLES_CONTENEDOR.has(node.role);
    const siguienteContenedor = esContenedor ? node : contenedor;
    const siguienteIndice = esContenedor ? (contadorContenedores += 1) : indiceContenedor;

    if (ROLES_CAMPO.has(node.role)) {
      grupoDe(siguienteContenedor, siguienteIndice).fields.push(entryFor(node));
    } else if (ROLES_ACCION.has(node.role)) {
      grupoDe(siguienteContenedor, siguienteIndice).actions.push(entryFor(node));
    } else if (node.supports.length > 0 && !esContenedor) {
      // Interactivo pero sin clasificar. Se cuenta en vez de desaparecer: si este número
      // no es 0, hay un rol que el catálogo no sabe encajar y el usuario debe saberlo.
      interactiveSkipped += 1;
      interactiveSkippedByRole[node.role] = (interactiveSkippedByRole[node.role] ?? 0) + 1;
    }

    for (const child of node.children) walk(child, siguienteContenedor, siguienteIndice);
  }

  walk(root, null, 0);

  return {
    target: options.target,
    scannedAt: options.scannedAt,
    // Los grupos vacíos no aportan: aparecen cuando un <form> no contiene ni campos ni
    // acciones (envoltorios de maquetado).
    groups: [...groups.values()]
      .filter((grupo) => grupo.fields.length > 0 || grupo.actions.length > 0)
      .map((grupo) => ({
        ...grupo,
        fields: colapsarRepetidas(grupo.fields),
        actions: colapsarRepetidas(grupo.actions),
      })),
    nodesScanned,
    interactiveSkipped,
    interactiveSkippedByRole,
  };
}

function celda(texto: string | null | undefined): string {
  if (!texto) return "—";
  // Las barras verticales rompen la tabla Markdown.
  return texto.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function selectorTexto(entry: CatalogEntry): string {
  if (!entry.selector) return "—";
  // En una entrada colapsada, el patrón es lo útil: el concreto solo sirve para la fila 1.
  const valor = entry.patternSelector ?? entry.selector.value;
  const nota =
    entry.occurrences > 1
      ? ` · ${entry.occurrences} elementos${entry.patternSelector ? "" : ", sin patrón común"}`
      : "";
  return `\`${celda(valor)}\` (${entry.selector.kind}${nota})`;
}

/** `Editar ×20` deja claro de un vistazo que la fila resume varios elementos. */
function nombreTexto(entry: CatalogEntry): string {
  const base = celda(entry.name);
  return entry.occurrences > 1 ? `${base} ×${entry.occurrences}` : base;
}

/**
 * Estado del control. Sin esto, un campo deshabilitado salía IDÉNTICO a uno normal en el
 * Markdown: el desarrollador pega el selector, llama a `fill()` y se come un timeout que
 * el catálogo podría haberle ahorrado. `required` tiene columna propia; el resto va aquí.
 */
function estadoTexto(entry: CatalogEntry): string {
  const marcas: string[] = [];
  if (entry.disabled) marcas.push("deshabilitado");
  if (entry.readonly) marcas.push("solo lectura");
  return marcas.length > 0 ? marcas.join(", ") : "—";
}

/**
 * Markdown para leer y pegar en un PR. Es el formato que hace útil la herramienta a un
 * humano; el JSON es el que la hace útil a un agente. Misma fuente, ADR-0006.
 */
export function renderCatalogMarkdown(catalog: Catalog): string {
  const lineas: string[] = [
    `# Escaneo de UI`,
    "",
    `**Objetivo:** ${catalog.target}`,
    `**Escaneado:** ${catalog.scannedAt}`,
    `**Nodos examinados:** ${catalog.nodesScanned}`,
    ...(catalog.interactiveSkipped > 0
      ? [
          "",
          `⚠️ **${catalog.interactiveSkipped} elementos interactivos quedaron fuera** ` +
            `(${Object.entries(catalog.interactiveSkippedByRole)
              .map(([role, n]) => `${role}: ${n}`)
              .join(", ")}). ` +
            "Los `generic` son esperados: controles reales que la app no expone con un rol " +
            "estándar, así que no hay forma fiable de nombrarlos. Cualquier OTRO rol aquí " +
            "es un hueco de la herramienta y conviene reportarlo.",
        ]
      : []),
    "",
    "> Los selectores caducan cuando la app se rediseña. Este documento tiene fecha por eso.",
    "",
  ];

  if (catalog.groups.length === 0) {
    lineas.push("_No se encontró ningún campo ni acción en la región escaneada._", "");
    return lineas.join("\n");
  }

  for (const grupo of catalog.groups) {
    const titulo = grupo.name ?? (grupo.role ? `(${grupo.role} sin nombre)` : "(sin agrupar)");
    lineas.push(`## ${titulo}`, "");

    if (grupo.fields.length > 0) {
      lineas.push("### Campos", "");
      lineas.push("| Campo | id | name | tipo | req | estado | selector |");
      lineas.push("|---|---|---|---|:--:|---|---|");
      for (const field of grupo.fields) {
        lineas.push(
          `| ${nombreTexto(field)} | ${celda(field.automationId)} | ${celda(field.attrName)} ` +
            `| ${field.nativeRole} | ${field.required ? "sí" : "no"} | ${estadoTexto(field)} ` +
            `| ${selectorTexto(field)} |`,
        );
      }
      lineas.push("");

      // `description` (placeholder / aria-describedby) es un campo de ADR-0006 que no
      // cabía en la tabla sin volverla ilegible, pero tirarlo haría que el Markdown y el
      // JSON dejaran de ser "dos formatos, una fuente".
      const conAyuda = grupo.fields.filter((f) => f.description);
      for (const field of conAyuda) {
        lineas.push(`- **${field.name ?? "(sin nombre)"}** — ayuda: _${celda(field.description)}_`);
      }
      if (conAyuda.length > 0) lineas.push("");

      const conOpciones = grupo.fields.filter((f) => f.options && f.options.length > 0);
      for (const field of conOpciones) {
        lineas.push(`- **${field.name ?? "(sin nombre)"}** admite: ${field.options!.join(", ")}`);
      }
      if (conOpciones.length > 0) lineas.push("");
    }

    if (grupo.actions.length > 0) {
      lineas.push("### Acciones", "");
      lineas.push("| Acción | tipo | selector |");
      lineas.push("|---|---|---|");
      for (const action of grupo.actions) {
        lineas.push(
          `| ${nombreTexto(action)} | ${action.nativeRole} | ${selectorTexto(action)} |`,
        );
      }
      lineas.push("");
    }
  }

  return lineas.join("\n");
}
