#!/usr/bin/env node
import { Command } from "commander";
import { Session, type Predicate, type Verb } from "@uui/core";
import { WebBackend, defaultProfileDir, openPersistentContext } from "@uui/backend-web";

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
    const backend = await WebBackend.launch(target, { headless: !opts.headed });
    const session = new Session(backend);
    try {
      return await fn(session);
    } finally {
      await session.dispose();
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

const program = new Command();
program
  .name("uui")
  .description("Universal UI Engine — CLI de depuración contra @uui/core (backend-web en F0)");

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
  .option("-m, --mode <mode>", "compact | full", "compact")
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
        mode: "compact" | "full";
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

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
