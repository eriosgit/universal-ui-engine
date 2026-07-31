import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import {
  normalizeAriaRole,
  type ActionArgs,
  type Backend,
  type BackendRegion,
  type Locator,
  type LocatorKind,
  type RawNode,
  type State,
  type Verb,
} from "@uui/core";
import { runInPage, type PageArgs, type PageRawNode, type PageResult } from "./pageScript.js";

const KNOWN_LOCATOR_KINDS: readonly LocatorKind[] = [
  "automationId",
  "testId",
  "attrName",
  "role+name",
  "css",
  "xpath",
  "sapId",
  "coords",
];

function toCoreLocatorKind(kind: string): LocatorKind {
  if ((KNOWN_LOCATOR_KINDS as readonly string[]).includes(kind)) return kind as LocatorKind;
  throw new Error(
    `backend-web: el page script devolvió un kind de locator inesperado: '${kind}'. ` +
      "Esto es un defecto interno de pageScript.ts, no algo que el consumidor causó.",
  );
}

function toCoreLocator(pageLocator: { kind: string; value: string; confidence: number }): Locator {
  return { kind: toCoreLocatorKind(pageLocator.kind), value: pageLocator.value, confidence: pageLocator.confidence };
}

function toPageLocatorDescriptor(locator: Locator): { kind: string; value: string } {
  return { kind: locator.kind, value: locator.value };
}

export type { BrowserContext, Page };

/** Perfil de navegador por defecto del motor: `~/.uui/profile`. Fuera del repo a
 * propósito — contiene cookies y sesiones REALES del usuario; jamás debe versionarse. */
export function defaultProfileDir(): string {
  return process.env["UUI_PROFILE_DIR"] ?? join(homedir(), ".uui", "profile");
}

/**
 * Abre un contexto de navegador PERSISTENTE sobre un directorio de perfil: cookies,
 * localStorage y sesiones sobreviven entre ejecuciones. Es lo que resuelve el caso
 * "para mí esta página es un dashboard, para el motor era un login": el usuario inicia
 * sesión UNA vez (headed, vía `uui login`) y a partir de ahí cualquier página abierta
 * sobre este perfil ve su sesión real.
 *
 * Un mismo perfil solo puede estar abierto por UN proceso a la vez (lock de Chromium):
 * si el navegador de `uui login` sigue abierto, un segundo proceso sobre el mismo
 * perfil fallará — cerrar el primero antes.
 */
export async function openPersistentContext(
  profileDir: string = defaultProfileDir(),
  options: { headless?: boolean } = {},
): Promise<BrowserContext> {
  const headless = options.headless ?? true;
  return chromium.launchPersistentContext(profileDir, {
    headless,
    // En headed (login manual) la ventana se comporta como un navegador normal, sin
    // viewport fijo emulado; en headless se mantiene el viewport por defecto.
    viewport: headless ? undefined : null,
  });
}

/**
 * `origin` (D5) se deja siempre ausente aquí: sin iframes anidados, todo `bounds` que
 * devuelve `pageScript.ts` ya vive en el único frame de la página (el propio viewport),
 * así que no hay un segundo marco de coordenadas que componer. Se activaría el día que
 * este backend soporte iframes, o contra un backend con varias ventanas.
 */
function toRawNode(pageNode: PageRawNode): RawNode {
  return {
    role: normalizeAriaRole(pageNode.role),
    nativeRole: pageNode.role,
    name: pageNode.name,
    automationId: pageNode.automationId,
    description: pageNode.description,
    options: pageNode.options,
    value: pageNode.value,
    states: new Set(pageNode.states as State[]),
    bounds: pageNode.bounds,
    decorative: pageNode.decorative,
    supports: pageNode.supports as Verb[],
    locators: pageNode.locators.map(toCoreLocator),
    children: pageNode.children.map(toRawNode),
    backend: "web",
  };
}

/**
 * Backend Web (ADR-0002): implementa el contrato `Backend` de `@uui/core` sobre
 * Playwright. Un único `page.evaluate(runInPage, …)` por operación — D2 nunca se filtra
 * fuera de esta clase.
 */
export class WebBackend implements Backend {
  readonly id = "web";

  private constructor(
    private readonly page: Page,
    private readonly browser: Browser | null,
  ) {}

  /** Conveniencia para CLI/MCP/demo: abre un Chromium propio y navega a `url`. Quien
   * llama es responsable de `dispose()` — cierra el browser que este método abrió. */
  static async launch(url: string, options: { headless?: boolean } = {}): Promise<WebBackend> {
    const browser = await chromium.launch({ headless: options.headless ?? true });
    const page = await browser.newPage();
    await page.goto(url);
    return new WebBackend(page, browser);
  }

  /** Para consumidores que ya administran su propia página de Playwright (p. ej. la
   * suite de conformidad reutilizando un browser entre casos de prueba). `dispose()` NO
   * cierra esta página — solo la libera un backend que abrió su propio browser. */
  static fromPage(page: Page): WebBackend {
    return new WebBackend(page, null);
  }

  private async run<T extends PageResult>(pageArgs: PageArgs): Promise<T> {
    return this.page.evaluate(runInPage, pageArgs) as Promise<T>;
  }

  async query(region: BackendRegion): Promise<RawNode> {
    const result = await this.run<Extract<PageResult, { op: "query" }>>({
      op: "query",
      root: region.root ? toPageLocatorDescriptor(region.root) : null,
      maxDepth: region.maxDepth ?? null,
      filterRole: region.filter?.role ?? null,
      filterNameContains: region.filter?.nameContains ?? null,
    });
    if (!result.root) {
      throw new Error(
        region.root
          ? `backend-web: la región anclada en '${region.root.kind}:${region.root.value}' ya no resuelve a un elemento único.`
          : "backend-web: no se pudo consultar document.body — ¿la página cargó?",
      );
    }
    return toRawNode(result.root);
  }

  async probeLocator(locator: Locator): Promise<boolean> {
    const result = await this.run<Extract<PageResult, { op: "probe" }>>({
      op: "probe",
      locator: toPageLocatorDescriptor(locator),
    });
    return result.ok;
  }

  async performAt(locator: Locator, verb: Verb, args?: ActionArgs): Promise<void> {
    const result = await this.run<Extract<PageResult, { op: "perform" }>>({
      op: "perform",
      locator: toPageLocatorDescriptor(locator),
      verb,
      value: args?.value ?? null,
    });
    if (!result.ok) {
      throw new Error(`backend-web: performAt('${verb}') falló: ${result.error}`);
    }
  }

  /** Contrato opcional (ADR-0004): para un backend web, "navegar" es ir a una URL. */
  async navigate(target: string): Promise<void> {
    await this.page.goto(target);
  }

  async dispose(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
    }
  }
}
