/**
 * Todo lo de este archivo corre DENTRO del navegador, vía `page.evaluate(runInPage, args)`.
 * Playwright serializa `runInPage` con `.toString()` y la ejecuta en un contexto aislado:
 * no puede cerrar sobre nada del módulo Node, ni sobre imports — solo sobre `args` y las
 * APIs del DOM. Por eso todos los helpers están declarados ANIDADOS dentro de la misma
 * función en vez de ser funciones de módulo (que Playwright no vería).
 *
 * D2 ("un evaluate único por región"): `query` hace UN solo recorrido del subárbol pedido
 * en esta llamada. `probe`/`perform` son operaciones puntuales distintas — no recorren el
 * árbol, resuelven un único locator — así que cada una es también una única llamada, no
 * una más sobre la misma región.
 *
 * Simplificación deliberada de F0: el cálculo de rol/nombre accesible es una
 * implementación PROPIA y simplificada (tag → rol ARIA, nombre por aria-label/
 * aria-labelledby/label/contenido), no el motor de accesibilidad real del navegador. Es
 * spec-correcto para los casos comunes que cubre `fixtures/web-app`, pero no persigue el
 * AOM completo — eso es harden­ing de F1/F5 si el benchmark contra apps reales lo exige.
 */

export type PageLocatorDescriptor = { kind: string; value: string };

export type PageRawNode = {
  role: string;
  name: string | null;
  value: string | null;
  states: string[];
  bounds: { x: number; y: number; w: number; h: number } | null;
  decorative: boolean;
  supports: string[];
  locators: { kind: string; value: string; confidence: number }[];
  children: PageRawNode[];
};

export type QueryArgs = {
  op: "query";
  root: PageLocatorDescriptor | null;
  maxDepth: number | null;
  filterRole: string | null;
  filterNameContains: string | null;
};
export type QueryResult = { op: "query"; root: PageRawNode | null };

export type ProbeArgs = { op: "probe"; locator: PageLocatorDescriptor };
export type ProbeResult = { op: "probe"; ok: boolean };

export type PerformArgs = {
  op: "perform";
  locator: PageLocatorDescriptor;
  verb: string;
  value: string | null;
};
export type PerformResult = { op: "perform"; ok: boolean; error: string | null };

export type PageArgs = QueryArgs | ProbeArgs | PerformArgs;
export type PageResult = QueryResult | ProbeResult | PerformResult;

export function runInPage(args: PageArgs): PageResult {
  // Declarado DENTRO de runInPage a propósito: Playwright serializa esta función con
  // `.toString()` y la ejecuta en un contexto aislado del navegador — cualquier
  // constante a nivel de módulo (fuera de esta función) sería invisible ahí. Todo lo que
  // el script necesita tiene que vivir en este scope o más adentro.
  // Roles que toman su nombre accesible del CONTENIDO (ARIA 1.2 §5.2.8.5).
  //
  // `listitem` NO está en esa lista de la especificación, y haberlo incluido causó un
  // defecto real y caro: un `listitem` que envuelve un submenú entero recibía como
  // "nombre" la concatenación del texto de TODOS sus descendientes
  // ("ingresosfactura de ventafacturas de venta recurrentes…") — el mismo contenido
  // pagado dos veces, en el padre y en cada hijo. Medido contra un dashboard real:
  // 115 de 136 nodos eran menú, y buena parte del peso venía de esta duplicación.
  //
  // `alert` y `status` sí se mantienen, como desviación DELIBERADA de la spec: son
  // regiones vivas donde el texto ES la información que el agente necesita leer
  // ("Sesión iniciada como dev2"), no un mero rótulo. Ver ADR-0003.
  const NAME_FROM_CONTENT_ROLES = new Set([
    "button",
    "link",
    "heading",
    "cell",
    "row",
    "columnheader",
    "rowheader",
    "tab",
    "menuitem",
    "option",
    "treeitem",
    "tooltip",
    "alert",
    "status",
  ]);

  let roleNameCounts = new Map<string, number>();

  function computeRole(el: Element): string {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit.toLowerCase();

    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") ?? "").toLowerCase();

    switch (tag) {
      case "button":
        return "button";
      case "a":
        return el.hasAttribute("href") ? "link" : "generic";
      case "input":
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        if (type === "range") return "slider";
        if (type === "number") return "spinbutton";
        if (type === "search") return "searchbox";
        return "textbox";
      case "textarea":
        return "textbox";
      case "select":
        return "combobox";
      case "option":
        return "option";
      case "table":
        return "table";
      case "tr":
        return "row";
      case "td":
        return "cell";
      case "th":
        return "columnheader";
      case "ul":
      case "ol":
        return "list";
      case "li":
        return "listitem";
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        return "heading";
      case "img":
        return "image";
      case "nav":
        return "navigation";
      case "form":
        return "form";
      case "main":
        return "main";
      case "header":
        return "banner";
      case "footer":
        return "contentinfo";
      case "article":
        return "article";
      case "dialog":
        return "dialog";
      case "section":
        return el.hasAttribute("aria-labelledby") || el.hasAttribute("aria-label")
          ? "region"
          : "generic";
      default:
        return "generic";
    }
  }

  function computeName(el: Element, role: string): string | null {
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const parts = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .filter(Boolean);
      if (parts.length > 0) return parts.join(" ");
    }

    const tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") {
      const id = el.getAttribute("id");
      if (id) {
        const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (label?.textContent?.trim()) return label.textContent.trim();
      }
      const closestLabel = el.closest("label");
      if (closestLabel?.textContent?.trim()) return closestLabel.textContent.trim();

      // Label VISUAL no vinculado: muchísimas apps reales (medido en un SaaS de
      // facturación) pintan `<div><label>Nombre*</label><input/></div>` sin `for`/`id`.
      // Un lector de pantalla tampoco lo asocia — es un defecto de accesibilidad de la
      // app — pero el label existe y es exactamente el nombre por el que un humano (y un
      // agente) llama al campo. Sin esto, formularios enteros son inalcanzables por
      // nombre y el motor deja de servir justo donde más valdría.
      //
      // Acotado a propósito para no robar el label de un campo vecino: se sube como
      // máximo 3 ancestros, y solo se acepta si ese ancestro contiene UN único label y
      // UN único control.
      let ancestor: Element | null = el.parentElement;
      for (let depth = 0; depth < 3 && ancestor; depth++) {
        const labels = ancestor.querySelectorAll("label");
        const controls = ancestor.querySelectorAll("input, textarea, select");
        if (labels.length === 1 && controls.length === 1) {
          const text = labels[0]?.textContent?.trim();
          if (text) return text;
        }
        ancestor = ancestor.parentElement;
      }

      const placeholder = el.getAttribute("placeholder");
      if (placeholder?.trim()) return placeholder.trim();
      return null;
    }

    if (tag === "img") {
      const alt = el.getAttribute("alt");
      return alt?.trim() ? alt.trim() : null;
    }

    if (NAME_FROM_CONTENT_ROLES.has(role)) {
      const text = el.textContent?.trim().replace(/\s+/g, " ") ?? "";
      return text || null;
    }

    return null;
  }

  function computeStates(el: Element): string[] {
    const states: string[] = [];
    const disabled =
      (el as HTMLInputElement).disabled === true || el.getAttribute("aria-disabled") === "true";
    if (!disabled) states.push("enabled");

    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const visible =
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none";
    if (visible) states.push("visible");

    if (document.activeElement === el) states.push("focused");

    const checked =
      (el as HTMLInputElement).checked === true ||
      el.getAttribute("aria-checked") === "true" ||
      el.getAttribute("aria-pressed") === "true";
    if (checked) states.push("checked");

    if (el.getAttribute("aria-expanded") === "true") states.push("expanded");

    const readonly =
      (el as HTMLInputElement).readOnly === true || el.getAttribute("aria-readonly") === "true";
    if (readonly) states.push("readonly");

    return states;
  }

  /** D6: capacidades DEL NODO — de esto depende que `core` nunca necesite preguntar
   * "¿eres el backend web?" para saber qué puede hacer con este elemento. */
  function computeSupports(el: Element, role: string): string[] {
    const supports: string[] = [];
    const tag = el.tagName.toLowerCase();
    const disabled =
      (el as HTMLInputElement).disabled === true || el.getAttribute("aria-disabled") === "true";
    if (disabled) return supports;

    if (["button", "link", "menuitem", "option", "tab"].includes(role)) supports.push("invoke");
    if (["textbox", "searchbox", "spinbutton"].includes(role)) supports.push("setValue");
    if (role === "checkbox" || role === "switch" || el.hasAttribute("aria-pressed")) {
      supports.push("toggle");
    }
    if (role === "radio" || tag === "select" || role === "combobox") supports.push("select");
    if (el.hasAttribute("aria-expanded")) supports.push("expand");
    if ((el as HTMLElement).tabIndex >= 0 || ["a", "button", "input", "select", "textarea"].includes(tag)) {
      supports.push("focus");
    }
    // `scrollIntoView` NO se ofrece incondicionalmente: sobre un `<tr>`/`<td>`/`<div>`
    // sin ninguna otra capacidad es ruido puro (todo nodo del DOM "soporta" desplazarse
    // a la vista, así que decirlo siempre no le dice nada al agente y solo infla tokens
    // — §3). Se ofrece cuando ya hay algo más que hacer con el nodo.
    if (supports.length > 0) supports.push("scrollIntoView");
    return supports;
  }

  /** D4: solo `generic` (sin rol semántico), sin nombre accesible y sin interacción —
   * exactamente el andamiaje de maquetación que `fixtures/web-app` mete a propósito.
   *
   * `scrollIntoView` y `focus` NO cuentan como "interacción" aquí: son capacidades casi
   * universales (todo elemento visible las soporta en mayor o menor medida) y, si
   * contaran, NINGÚN nodo calificaría jamás como decorativo — `supports` nunca estaría
   * vacío. Lo que de verdad distingue un widget real de un `div` de maquetación son los
   * verbos que cambian algo (invoke/setValue/toggle/select/expand). */
  function computeDecorative(role: string, name: string | null, supports: string[]): boolean {
    if (role !== "generic") return false;
    if (name) return false;
    const meaningful = supports.filter((v) => v !== "scrollIntoView" && v !== "focus");
    return meaningful.length === 0;
  }

  function cssPathFor(el: Element): string {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node !== document.body && node.parentElement) {
      // `parentEl` (no `parent`): `parent` es un global del DOM (Window.parent) y
      // sombrearlo confunde la inferencia de tipos de TS en este bucle.
      const parentEl: Element = node.parentElement;
      const index = Array.from(parentEl.children).indexOf(node) + 1;
      parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
      node = parentEl;
    }
    parts.unshift("body");
    return parts.join(" > ");
  }

  function xpathFor(el: Element): string {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node !== document.body && node.parentElement) {
      const parentEl: Element = node.parentElement;
      const currentTag = node.tagName;
      const sameTagSiblings = Array.from(parentEl.children).filter((c) => c.tagName === currentTag);
      const index = sameTagSiblings.indexOf(node) + 1;
      parts.unshift(`${node.tagName.toLowerCase()}[${index}]`);
      node = parentEl;
    }
    return `/html/body/${parts.join("/")}`;
  }

  /** Índice O(n), calculado UNA vez por `query()`, para no ofrecer un locator `role+name`
   * que en realidad no es único — eso sería mentir sobre su robustez (ver resolver.ts). */
  function buildRoleNameCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const role = computeRole(el);
      const name = computeName(el, role);
      if (!name) continue;
      const key = `${role} ${name}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  function computeLocators(
    el: Element,
    role: string,
    name: string | null,
  ): { kind: string; value: string; confidence: number }[] {
    const locators: { kind: string; value: string; confidence: number }[] = [];

    const testId = el.getAttribute("data-testid");
    if (testId) locators.push({ kind: "testId", value: testId, confidence: 0.95 });

    if (name && (roleNameCounts.get(`${role} ${name}`) ?? 0) === 1) {
      locators.push({ kind: "role+name", value: `${role} ${name}`, confidence: 0.8 });
    }

    locators.push({ kind: "css", value: cssPathFor(el), confidence: 0.6 });
    locators.push({ kind: "xpath", value: xpathFor(el), confidence: 0.55 });

    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    locators.push({ kind: "coords", value: `${cx},${cy}`, confidence: 0.05 });

    return locators;
  }

  function resolveLocator(desc: PageLocatorDescriptor): Element | null {
    if (desc.kind === "testId") {
      const matches = document.querySelectorAll(`[data-testid="${CSS.escape(desc.value)}"]`);
      return matches.length === 1 ? matches[0]! : null;
    }
    if (desc.kind === "css") {
      try {
        const matches = document.querySelectorAll(desc.value);
        return matches.length === 1 ? matches[0]! : null;
      } catch {
        return null;
      }
    }
    if (desc.kind === "xpath") {
      try {
        const result = document.evaluate(
          desc.value,
          document,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null,
        );
        return result.snapshotLength === 1 ? (result.snapshotItem(0) as Element) : null;
      } catch {
        return null;
      }
    }
    if (desc.kind === "role+name") {
      const [rolePart, namePart] = desc.value.split(" ");
      const candidates = Array.from(document.querySelectorAll("*")).filter((el) => {
        const role = computeRole(el);
        if (role !== rolePart) return false;
        return computeName(el, role) === namePart;
      });
      return candidates.length === 1 ? candidates[0]! : null;
    }
    if (desc.kind === "coords") {
      const [xStr, yStr] = desc.value.split(",");
      const x = Number(xStr);
      const y = Number(yStr);
      return document.elementFromPoint(x, y);
    }
    return null;
  }

  function matchesFilter(
    node: PageRawNode,
    filterRole: string | null,
    filterNameContains: string | null,
  ): boolean {
    if (filterRole && node.role !== filterRole) return false;
    if (filterNameContains) {
      if (!node.name || !node.name.toLowerCase().includes(filterNameContains.toLowerCase())) {
        return false;
      }
    }
    return true;
  }

  /**
   * Encuentra los subárboles MÁS ALTOS que matchean el filtro y los devuelve COMPLETOS,
   * sin seguir filtrando hacia adentro — una vez que un nodo matchea (p. ej. el `form`
   * del login), todo lo que hay debajo es parte de lo que se pidió (sus inputs, su
   * botón), no candidatos a un segundo filtrado. Si se re-aplicara el mismo filtro
   * recursivamente sin este corte, filtrar por `role:'form'` habría vaciado el propio
   * formulario, porque sus hijos (input, button) no tienen ellos mismos `role:'form'`.
   */
  function collectFilterMatches(
    node: PageRawNode,
    filterRole: string | null,
    filterNameContains: string | null,
  ): PageRawNode[] {
    if (matchesFilter(node, filterRole, filterNameContains)) {
      return [node];
    }
    return node.children.flatMap((child) =>
      collectFilterMatches(child, filterRole, filterNameContains),
    );
  }

  /** La raíz de la región SIEMPRE se conserva — es lo que el consumidor pidió
   * explícitamente (mismo principio que D4 aplica a `decorative`) — pero sus hijos sí se
   * filtran normalmente. Si la raíz misma matchea, ya está completa: no hace falta
   * tocarla. */
  function applyFilter(
    root: PageRawNode,
    filterRole: string | null,
    filterNameContains: string | null,
  ): PageRawNode {
    if (matchesFilter(root, filterRole, filterNameContains)) return root;
    return {
      ...root,
      children: root.children.flatMap((child) =>
        collectFilterMatches(child, filterRole, filterNameContains),
      ),
    };
  }

  function walk(el: Element, depth: number, maxDepth: number | null): PageRawNode {
    const role = computeRole(el);
    const name = computeName(el, role);
    const supports = computeSupports(el, role);
    // depth===0 es SIEMPRE la raíz de la región que se está consultando ahora mismo — o
    // bien el locator resuelto que pidió el consumidor, o `document.body` por defecto.
    // Por contrato (ver pruneDecorative en @uui/core), esa raíz nunca puede llegar
    // marcada `decorative`: es el ancla que se pidió explícitamente, nunca andamiaje
    // podable. Sin este caso especial, una página cuyo <body> no tenga rol semántico ni
    // nombre (el caso normal) se podaría a sí misma y violaría ese invariante.
    const decorative = depth === 0 ? false : computeDecorative(role, name, supports);
    const rect = el.getBoundingClientRect();
    const bounds =
      rect.width > 0 || rect.height > 0
        ? { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
        : null;
    const tag = el.tagName.toLowerCase();
    const value =
      tag === "input" || tag === "textarea" || tag === "select"
        ? ((el as HTMLInputElement).value ?? null)
        : null;

    const children: PageRawNode[] =
      maxDepth === null || depth < maxDepth
        ? Array.from(el.children).map((child) => walk(child, depth + 1, maxDepth))
        : [];

    return {
      role,
      name,
      value,
      states: computeStates(el),
      bounds,
      decorative,
      supports,
      locators: computeLocators(el, role, name),
      children,
    };
  }

  function runQuery(queryArgs: QueryArgs): QueryResult {
    const rootEl = queryArgs.root ? resolveLocator(queryArgs.root) : document.body;
    if (!rootEl) return { op: "query", root: null };

    roleNameCounts = buildRoleNameCounts();
    const rawRoot = walk(rootEl, 0, queryArgs.maxDepth);

    if (queryArgs.filterRole || queryArgs.filterNameContains) {
      const filtered = applyFilter(rawRoot, queryArgs.filterRole, queryArgs.filterNameContains);
      return { op: "query", root: filtered };
    }
    return { op: "query", root: rawRoot };
  }

  function runProbe(probeArgs: ProbeArgs): ProbeResult {
    return { op: "probe", ok: resolveLocator(probeArgs.locator) !== null };
  }

  function runPerform(performArgs: PerformArgs): PerformResult {
    const el = resolveLocator(performArgs.locator);
    if (!el) {
      return { op: "perform", ok: false, error: "el locator no resolvió a un elemento único" };
    }
    try {
      switch (performArgs.verb) {
        case "invoke":
          (el as HTMLElement).click();
          break;
        case "focus":
          (el as HTMLElement).focus();
          break;
        case "scrollIntoView":
          el.scrollIntoView({ block: "center", inline: "center" });
          break;
        case "toggle":
          (el as HTMLElement).click();
          break;
        case "expand":
          (el as HTMLElement).click();
          break;
        case "select": {
          if (el.tagName === "OPTION") {
            const select = el.closest("select");
            if (select) {
              select.value = (el as HTMLOptionElement).value;
              select.dispatchEvent(new Event("change", { bubbles: true }));
            }
          } else {
            (el as HTMLElement).click();
          }
          break;
        }
        case "setValue": {
          const proto = Object.getPrototypeOf(el);
          const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
          if (descriptor?.set) {
            descriptor.set.call(el, performArgs.value ?? "");
          } else {
            (el as HTMLInputElement).value = performArgs.value ?? "";
          }
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          break;
        }
        default:
          return { op: "perform", ok: false, error: `verbo desconocido: ${performArgs.verb}` };
      }
      return { op: "perform", ok: true, error: null };
    } catch (error) {
      return { op: "perform", ok: false, error: String(error) };
    }
  }

  switch (args.op) {
    case "query":
      return runQuery(args);
    case "probe":
      return runProbe(args);
    case "perform":
      return runPerform(args);
  }
}
