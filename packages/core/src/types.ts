/**
 * Modelo Universal de UI — congelado en ADR-0001.
 *
 * Estas son las únicas fuentes de verdad para la forma de un nodo. No se introducen
 * campos nuevos sin un ADR (§5.5 del plan: el contrato core↔Backend no se delega).
 */

export type BackendId = "web" | "uia" | "sap" | (string & {});

/**
 * D3: vocabulario ARIA normalizado, CERRADO y versionado. Un backend cuyo control nativo
 * no tenga equivalente cae en 'generic' (control real, sin mapeo) — nunca se inventa un rol
 * nuevo sin pasar por ADR + actualización de golden trees.
 */
export const ROLES = [
  "button",
  "link",
  "textbox",
  "searchbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "option",
  "menu",
  "menuitem",
  "tab",
  "tablist",
  "tabpanel",
  "row",
  "cell",
  "columnheader",
  "rowheader",
  "grid",
  "table",
  "list",
  "listitem",
  "heading",
  "image",
  "dialog",
  "alert",
  "status",
  "tooltip",
  "progressbar",
  "slider",
  "spinbutton",
  "switch",
  "tree",
  "treeitem",
  "toolbar",
  "group",
  "region",
  "navigation",
  "form",
  "banner",
  "contentinfo",
  "main",
  "complementary",
  "article",
  "document",
  "window",
  /** Control real sin mapeo canónico. NO es lo mismo que `decorative` (D4): un `generic`
   * puede perfectamente ser interactivo (p. ej. un GuiGridView de SAP) — solo carece de
   * un rol ARIA equivalente. */
  "generic",
] as const;

export type Role = (typeof ROLES)[number];

/** `required` (ADR-0006) es un estado del control igual que `readonly`: web lo declara con
 * `required`/`aria-required`, UIA con `IsRequiredForForm`. */
export type State =
  | "enabled"
  | "visible"
  | "focused"
  | "checked"
  | "expanded"
  | "readonly"
  | "required";

/** D5: absoluto de escritorio, en píxeles físicos (DPI-aware), e INFORMATIVO — nunca la
 * fuente de verdad para actuar (eso lo decide el resolver vía locators, ver resolver.ts). */
export type Rect = { x: number; y: number; w: number; h: number };

export type LocatorKind =
  | "automationId"
  | "testId"
  /** Atributo de envío del campo (`[name=email]` en web). Es una forma de localizar, no un
   * dato suelto (ADR-0006); los backends sin equivalente simplemente no lo emiten. */
  | "attrName"
  | "role+name"
  | "css"
  | "xpath"
  | "sapId"
  | "coords";

export type Locator = {
  kind: LocatorKind;
  value: string;
  /** 0..1 — confianza estimada, usada como desempate dentro del mismo escalón de
   * degradación (ver resolver.DEGRADATION_ORDER). */
  confidence: number;
};

/**
 * D6: conjunto CERRADO de primitivas, alineadas a los ControlPattern de UIA. El backend no
 * decide qué verbo se ejecuta — el NODO declara en `supports` cuáles admite. Esto hace
 * estructuralmente imposible ramificar el núcleo por identidad de backend: core siempre
 * pregunta capacidad ("¿soporta `toggle`?"), nunca identidad ("¿es UIA?").
 */
export const VERBS = [
  "invoke",
  "setValue",
  "toggle",
  "expand",
  "select",
  "focus",
  "scrollIntoView",
] as const;

export type Verb = (typeof VERBS)[number];

export type ActionArgs = {
  /** Para `setValue`. */
  value?: string;
  /** Para `toggle`/`select` cuando el backend necesita un valor objetivo explícito
   * en vez de alternar el estado actual. */
  checked?: boolean;
};

/**
 * D1: lo que hay *detrás* de un `uid`. Nunca se expone al consumidor — vive solo en el
 * registro de sesión del núcleo (ver session.ts).
 */
export type Fingerprint = {
  /** Ordenados por robustez estimada declarada por el backend en el momento del query. */
  locators: Locator[];
  /** Ruta estructural podada (índices entre hijos NO decorativos) — último recurso si
   * todos los locators fallan. Reservado para backends sin locators estables (p. ej. un
   * `Pane` de UIA sin AutomationId). No se usa todavía en F0/backend-web. */
  path: number[];
};

export type UINode = {
  /** Opaco, de sesión. Resuelve a un Fingerprint — nunca a un handle vivo (D1). */
  uid: string;
  role: Role;
  /** Rol crudo del backend. Campo de primera clase — NO vive en `raw` (D3), porque
   * `ui.find` debe poder filtrar por él. */
  nativeRole: string;
  name: string | null;
  /** Identificador estable declarado por la propia app: atributo `id` en web,
   * `AutomationId` en UIA, id de control en SAP (ADR-0006). Es el dato que un
   * desarrollador quiere pegar en su proyecto, así que es de primera clase, no `raw`. */
  automationId: string | null;
  /** Texto de ayuda del control: `placeholder`/`aria-describedby` en web, `HelpText` en
   * UIA (ADR-0006). No es el nombre: describe, no identifica. */
  description: string | null;
  /** Opciones de un control de selección: `<option>` en web, `SelectionPattern` en UIA.
   * `null` en los nodos que no seleccionan nada (ADR-0006). */
  options: string[] | null;
  value?: string | null;
  states: Set<State>;
  /** Absoluto de pantalla, informativo (D5). `compact` lo omite. Se interpreta relativo
   * al `origin` del ancestro raíz de marco más cercano (ver `origin` más abajo). */
  bounds: Rect | null;
  /** Presente solo en nodos que son raíz de un marco de coordenadas propio (ventana,
   * documento, iframe). Ausente en el resto de los nodos. La especialización por backend
   * vive en ADR-0002: para backend-web el origin de la raíz es siempre {0,0} — Playwright
   * no expone la posición de la ventana del SO en la pantalla física, así que "absoluto de
   * escritorio" (D5) se reduce, para un backend puramente de navegador, a "absoluto del
   * frame superior de la página". Un backend OS-level (UIA) sí puede dar un origin de
   * escritorio verdadero. */
  origin?: { x: number; y: number };
  /** Lo calcula el backend con reglas declarativas propias; lo consume el serializador
   * para podar+reparentar en modo `compact` (D4). Nunca se descarta información río arriba. */
  decorative: boolean;
  /** Capacidades DEL NODO, no del backend (D6). */
  supports: Verb[];
  /** Marcado por el serializador cuando este nodo RESUME un grupo de nodos que la sesión
   * ya envió antes, idénticos, en otra pantalla — el cromo persistente (menú lateral,
   * cabecera) que de otro modo se repagaría en cada snapshot (ADR-0003). No se pierde
   * nada: `ui.find` siempre recorre el árbol completo, así que cualquier nodo resumido
   * aquí se localiza por nombre cuando de verdad haga falta actuar sobre él. */
  collapsed?: boolean;
  /** Opcional a propósito: el backend SIEMPRE lo puebla (es lo que hace re-resoluble al
   * `uid`), pero el serializador lo OMITE por completo al proyectar hacia un consumidor
   * (ver `stripInternalFields` en serialize.ts) — exponerlo violaría la opacidad de D1 y
   * es la mayor fuente de bloat de tokens de un nodo (rutas css/xpath completas). */
  locators?: Locator[];
  children: UINode[];
  backend: BackendId;
  /** Escotilla de escape por backend. NUNCA leída por el núcleo, y nunca serializada hacia
   * un consumidor (ver serialize.ts) — es puramente para depuración interna del backend. */
  raw?: unknown;
};

/**
 * D2: la perezosidad es propiedad del CONTRATO. `core` nunca pide "el árbol completo" —
 * siempre una región acotada, y el backend decide cómo satisfacerla.
 */
export type Region = {
  /** uid de un nodo previamente devuelto, o `undefined` = raíz de la ventana/sesión activa. */
  root?: string;
  maxDepth?: number;
  filter?: { role?: Role; nameContains?: string };
};

/**
 * Proyecciones del árbol hacia un consumidor (ADR-0003):
 *
 * - `actionable`: SOLO lo que el agente puede accionar (nodos con un verbo significativo)
 *   más los `heading` que dan contexto. Es la respuesta a "¿qué puedo hacer aquí?" y la
 *   proyección más barata con diferencia — medida contra un dashboard real: 224 tokens
 *   frente a 6.811 del árbol completo.
 * - `compact`: el árbol legible, sin decorativos, sin bounds y sin envoltorios
 *   redundantes. Para "¿qué hay en esta pantalla?".
 * - `full`: todo, incluidos decorativos y bounds. Para depurar el motor.
 */
export type SerializeMode = "actionable" | "compact" | "full";

export type SnapshotOptions = Region & { mode?: SerializeMode };

export type Snapshot = {
  root: UINode;
  mode: SerializeMode;
  /** Métrica obligatoria (§3 del plan): heurística de tokens, no un tokenizer real todavía. */
  tokenEstimate: number;
};
