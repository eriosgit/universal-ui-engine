#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "commander";
import {
  Session,
  renderCatalogMarkdown,
  runFlow,
  type Flow,
  type Predicate,
  type Verb,
} from "@uui/core";
import { WebBackend, defaultProfileDir, openPersistentContext } from "@uui/backend-web";
import { TARGETS, extensionFor, generate, type Target } from "@uui/codegen";

/**
 * `uui` — el bucle de depuración del agente contra @uui/core (§5.2 del plan: sustituye
 * DELIBERADAMENTE a un MCP de navegador). Si esta CLI no alcanza para depurar algo, eso
 * es un requisito de producto faltante, no un motivo para instalar un MCP de navegador.
 *
 * Sesiones: por defecto toda operación usa el PERFIL PERSISTENTE (~/.uui/profile) — si
 * el usuario ya inició sesión en una app vía `uui login`, snapshot/find/act ven SU
 * sesión (su dashboard), no la página de login que vería un navegador limpio. `--clean`
 * recupera el comportamiento sin estado.
 *
 * Cada invocación sigue siendo un proceso nuevo: abre el navegador, hace UNA operación,
 * imprime JSON, cierra. Por diseño (D1: el `uid` es opaco DE SESIÓN) un uid impreso por
 * una invocación no sirve para otra — por eso `act` puede localizar su objetivo inline
 * (--find/--role) en vez de exigir un uid de un `snapshot` previo.
 */

/**
 * Nombre de archivo derivado de la URL: `https://app.com/auth/login` → `auth-login`.
 * Sin esto, escanear tres pantallas de la misma app sobrescribe siempre el mismo archivo.
 */
function nombreDesdeTarget(target: string): string {
  let ruta = target;
  try {
    ruta = new URL(target).pathname;
  } catch {
    // No era una URL absoluta (p. ej. una ruta de archivo): se usa tal cual.
  }
  const limpio = ruta
    .replace(/\.[a-z0-9]+$/i, "")
    .split("/")
    .filter(Boolean)
    .join("-")
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
  return limpio || "inicio";
}

function printJson(value: unknown): void {
  process.stdout.write(
    `${JSON.stringify(value, (_key, v) => (v instanceof Set ? [...v] : v), 2)}\n`,
  );
}

type BrowserOpts = { headed?: boolean; clean?: boolean; profile?: string };

async function withSession<T>(
  target: string,
  opts: BrowserOpts,
  fn: (session: Session) => Promise<T>,
): Promise<T> {
  if (opts.clean) {
    // `WebBackend.launch` abre el navegador Y navega. Si el `goto` rechaza (URL caída,
    // DNS, SSL) con el `try` puesto DESPUÉS del await, el finally nunca se instala: el
    // navegador queda huérfano y el proceso no puede terminar. Reproducido contra un
    // puerto cerrado: 45s sin salir y tres `chrome-headless-shell` vivos.
    let backend: Awaited<ReturnType<typeof WebBackend.launch>> | undefined;
    try {
      backend = await WebBackend.launch(target, { headless: !opts.headed });
      return await fn(new Session(backend));
    } finally {
      await backend?.dispose();
    }
  }

  const context = await openPersistentContext(opts.profile ?? defaultProfileDir(), {
    headless: !opts.headed,
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(target);
    const session = new Session(WebBackend.fromPage(page));
    return await fn(session);
  } finally {
    await context.close();
  }
}

/** Lo inyecta esbuild al empaquetar `uui-scan`; en desarrollo, 0.0.0. */
declare const __UUI_VERSION__: string | undefined;

const program = new Command();
program
  .name("uui-scan")
  // Inyectada por esbuild al empaquetar (ver packages/uui-scan/build.mjs).
  .version(typeof __UUI_VERSION__ === "string" ? __UUI_VERSION__ : "0.0.0")
  .description(
    "Escanea una pantalla y devuelve el catálogo de selectores. " +
      "`uui-scan scan <url>` es el comando principal; el resto son utilidades del motor.",
  );

program
  .command("login")
  .description(
    "Abre un navegador VISIBLE sobre el perfil persistente para que inicies sesión a mano. " +
      "Cierra el navegador cuando termines; desde entonces snapshot/find/act ven tu sesión.",
  )
  .argument("<target>", "URL de la página de login (p. ej. https://app.alegra.com)")
  .option("--profile <dir>", "directorio de perfil (por defecto ~/.uui/profile)")
  .action(async (target: string, opts: { profile?: string }) => {
    const profileDir = opts.profile ?? defaultProfileDir();
    const context = await openPersistentContext(profileDir, { headless: false });
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(target);
    process.stderr.write(
      `Perfil: ${profileDir}\n` +
        "Inicia sesión en la ventana del navegador. Cuando termines, CIERRA el navegador —\n" +
        "la sesión queda guardada y los próximos snapshot/find/act la verán.\n",
    );
    await new Promise<void>((resolve) => context.on("close", () => resolve()));
    process.stderr.write("Sesión guardada.\n");
  });

program
  .command("snapshot")
  .description("Toma un snapshot de una región del target (con tu sesión guardada, si existe)")
  .argument("<target>", "URL http:// o file:// a abrir")
  .option("-m, --mode <mode>", "actionable | compact | full", "compact")
  .option("-d, --depth <n>", "maxDepth", (v) => Number.parseInt(v, 10))
  .option("--filter-role <role>", "filtrar por role canónico")
  .option("--filter-name <text>", "filtrar por nombre (contiene)")
  .option("--headed", "abrir el navegador visible en vez de headless", false)
  .option("--clean", "navegador limpio, sin el perfil persistente", false)
  .option("--profile <dir>", "directorio de perfil (por defecto ~/.uui/profile)")
  .action(
    async (
      target: string,
      opts: {
        mode: "actionable" | "compact" | "full";
        depth?: number;
        filterRole?: string;
        filterName?: string;
      } & BrowserOpts,
    ) => {
      const snapshot = await withSession(target, opts, (session) =>
        session.snapshot({
          mode: opts.mode,
          maxDepth: opts.depth,
          filter:
            opts.filterRole || opts.filterName
              ? { role: opts.filterRole as never, nameContains: opts.filterName }
              : undefined,
        }),
      );
      printJson(snapshot);
    },
  );

program
  .command("scan")
  .description(
    "Escanea una pantalla y devuelve el CATÁLOGO DE SELECTORES: cada campo con su id, " +
      "name, tipo, si es obligatorio y con qué selector alcanzarlo (ADR-0006).",
  )
  .argument("<target>", "URL http:// o file:// a escanear")
  .option("-o, --out <dir>", "escribir <nombre>.json y <nombre>.md en este directorio")
  .option("--name <name>", "nombre base de los archivos (por defecto, se deriva de la URL)")
  .option("--format <fmt>", "md | json — qué imprimir por stdout si no se usa --out", "md")
  .option(
    "--quiet-ms <n>",
    "ms que la pantalla debe estar sin cambiar antes de capturar (ADR-0005)",
    (v) => Number.parseInt(v, 10),
  )
  .option("--no-wait", "capturar de inmediato, sin esperar a que la SPA se asiente")
  .option("--filter-role <role>", "acotar el escaneo a una región por rol")
  .option("--filter-name <text>", "acotar el escaneo a una región por nombre (contiene)")
  .option("--headed", "abrir el navegador visible en vez de headless", false)
  .option("--clean", "navegador limpio, sin el perfil persistente", false)
  .option("--profile <dir>", "directorio de perfil (por defecto ~/.uui/profile)")
  .action(
    async (
      target: string,
      opts: {
        out?: string;
        name?: string;
        format: "md" | "json";
        quietMs?: number;
        wait: boolean;
        filterRole?: string;
        filterName?: string;
      } & BrowserOpts,
    ) => {
      const catalog = await withSession(target, opts, (session) =>
        session.catalog({
          target,
          scannedAt: new Date().toISOString(),
          // Por defecto se espera: un catálogo de una SPA a medio cargar sale corto y con
          // apariencia de estar completo, que es peor que fallar.
          stabilize: opts.wait === false ? false : { quietMs: opts.quietMs },
          filter:
            opts.filterRole || opts.filterName
              ? { role: opts.filterRole as never, nameContains: opts.filterName }
              : undefined,
        }),
      );

      if (!opts.out) {
        if (opts.format === "json") printJson(catalog);
        else process.stdout.write(`${renderCatalogMarkdown(catalog)}\n`);
        return;
      }

      const base = opts.name ?? nombreDesdeTarget(target);
      await mkdir(opts.out, { recursive: true });
      const rutaJson = join(opts.out, `${base}.json`);
      const rutaMd = join(opts.out, `${base}.md`);
      await writeFile(rutaJson, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
      await writeFile(rutaMd, `${renderCatalogMarkdown(catalog)}\n`, "utf8");
      process.stderr.write(`Escrito: ${rutaJson}\nEscrito: ${rutaMd}\n`);
    },
  );

program
  .command("find")
  .description("Busca nodos por nombre y/o rol (predicados deterministas — D7)")
  .argument("<target>", "URL http:// o file:// a abrir")
  .argument("<query>", "texto que debe contener el nombre accesible")
  .option("--role <role>", "exigir además este role canónico")
  .option("--headed", "abrir el navegador visible en vez de headless", false)
  .option("--clean", "navegador limpio, sin el perfil persistente", false)
  .option("--profile <dir>", "directorio de perfil (por defecto ~/.uui/profile)")
  .action(async (target: string, query: string, opts: { role?: string } & BrowserOpts) => {
    const predicate: Predicate = opts.role
      ? { kind: "and", all: [{ kind: "role", role: opts.role as never }, { kind: "nameContains", text: query }] }
      : { kind: "nameContains", text: query };
    const matches = await withSession(target, opts, (session) => session.find(predicate));
    printJson(matches);
  });

program
  .command("act")
  .description("Ejecuta un verbo sobre el nodo encontrado por --find/--role en esta misma invocación")
  .argument("<target>", "URL http:// o file:// a abrir")
  .argument("<verb>", "invoke | setValue | toggle | expand | select | focus | scrollIntoView")
  .requiredOption("--find <text>", "texto que debe contener el nombre accesible del objetivo")
  .option("--role <role>", "exigir además este role canónico")
  .option("--value <value>", "valor para setValue")
  .option("--headed", "abrir el navegador visible en vez de headless", false)
  .option("--clean", "navegador limpio, sin el perfil persistente", false)
  .option("--profile <dir>", "directorio de perfil (por defecto ~/.uui/profile)")
  .action(
    async (
      target: string,
      verb: string,
      opts: { find: string; role?: string; value?: string } & BrowserOpts,
    ) => {
      const predicate: Predicate = opts.role
        ? { kind: "and", all: [{ kind: "role", role: opts.role as never }, { kind: "nameContains", text: opts.find }] }
        : { kind: "nameContains", text: opts.find };

      const result = await withSession(target, opts, async (session) => {
        const [match] = await session.find(predicate);
        if (!match) {
          throw new Error(`No se encontró ningún nodo que matchee: ${JSON.stringify(predicate)}`);
        }
        return session.act(match.uid, verb as Verb, opts.value ? { value: opts.value } : undefined);
      });
      printJson(result);
    },
  );

program
  .command("run")
  .description(
    "Ejecuta un flujo (.json) SIN IA: pasos deterministas, esperas por condición y " +
      "validaciones. Es el artefacto que produce el trabajo de descubrimiento.",
  )
  .argument("<flow>", "ruta a un archivo de flujo .json")
  .option("--headed", "abrir el navegador visible en vez de headless", false)
  .option("--clean", "navegador limpio, sin el perfil persistente", false)
  .option("--profile <dir>", "directorio de perfil (por defecto ~/.uui/profile)")
  .action(async (flowPath: string, opts: BrowserOpts) => {
    const flow = JSON.parse(await readFile(flowPath, "utf8")) as Flow;
    const primerGoto = flow.steps.find((s) => s.action === "goto");
    if (!primerGoto) {
      throw new Error(
        "El flujo debe empezar con un paso 'goto': la CLI necesita saber a dónde abrir el navegador.",
      );
    }

    const result = await withSession(primerGoto.target, opts, (session) => runFlow(session, flow));

    for (const step of result.steps) {
      const icono = step.status === "ok" ? "OK  " : "FALLA";
      const etiqueta = step.step.label ?? step.step.action;
      process.stderr.write(
        `${icono} [${String(step.index).padStart(2)}] ${etiqueta} (${step.durationMs}ms)` +
          `${step.error ? `\n      ${step.error}` : ""}\n`,
      );
    }
    process.stderr.write(`\n${result.status.toUpperCase()} en ${result.durationMs}ms\n`);
    printJson({ status: result.status, data: result.data });
    if (result.status === "failed") process.exitCode = 1;
  });

program
  .command("codegen")
  .description(
    "Genera código AUTÓNOMO a partir de un flujo: un script que corre sin uui y sin IA. " +
      "Este es el producto final del ciclo (la IA descubre una vez; el código corre siempre).",
  )
  .argument("<flow>", "ruta a un archivo de flujo .json")
  .option("-t, --target <target>", `uno de: ${TARGETS.join(" | ")}`, "playwright-ts")
  .option("-o, --out <file>", "escribir a un archivo (por defecto: stdout)")
  .option("--headed", "el script generado abre el navegador visible", false)
  .action(async (flowPath: string, opts: { target: string; out?: string; headed: boolean }) => {
    if (!(TARGETS as readonly string[]).includes(opts.target)) {
      throw new Error(`Target desconocido: '${opts.target}'. Opciones: ${TARGETS.join(", ")}`);
    }
    const flow = JSON.parse(await readFile(flowPath, "utf8")) as Flow;
    const code = generate(flow, opts.target as Target, { headless: !opts.headed });
    if (opts.out) {
      // Si el nombre no trae extensión, se sugiere la del target; si ya la trae, se
      // respeta tal cual (antes se concatenaba y salía "gen.py.py").
      const destino = /\.[a-z]+$/i.test(opts.out)
        ? opts.out
        : `${opts.out}${extensionFor(opts.target as Target)}`;
      await writeFile(destino, code, "utf8");
      process.stderr.write(`Escrito: ${destino}\n`);
    } else {
      process.stdout.write(code);
    }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
