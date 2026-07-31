#!/usr/bin/env node
import { Command } from "commander";
import { Session, type Predicate, type Verb } from "@uui/core";
import { WebBackend } from "@uui/backend-web";

/**
 * `uui` — el bucle de depuración del agente contra @uui/core (§5.2 del plan: sustituye
 * DELIBERADAMENTE a un MCP de navegador). Si esta CLI no alcanza para depurar algo, eso
 * es un requisito de producto faltante, no un motivo para instalar un MCP de navegador.
 *
 * Cada invocación es un proceso nuevo: abre su propio Chromium, hace UNA operación,
 * imprime JSON, cierra. Por diseño (D1: el `uid` es opaco DE SESIÓN) un uid impreso por
 * una invocación no sirve para otra — por eso `act` puede localizar su objetivo inline
 * (--find/--role) en vez de exigir un uid de un `snapshot` previo.
 */

function printJson(value: unknown): void {
  process.stdout.write(
    `${JSON.stringify(value, (_key, v) => (v instanceof Set ? [...v] : v), 2)}\n`,
  );
}

async function withBackend<T>(
  target: string,
  headed: boolean,
  fn: (session: Session) => Promise<T>,
): Promise<T> {
  const backend = await WebBackend.launch(target, { headless: !headed });
  const session = new Session(backend);
  try {
    return await fn(session);
  } finally {
    await session.dispose();
  }
}

const program = new Command();
program
  .name("uui")
  .description("Universal UI Engine — CLI de depuración contra @uui/core (backend-web en F0)");

program
  .command("snapshot")
  .description("Toma un snapshot de una región del target")
  .argument("<target>", "URL http:// o file:// a abrir")
  .option("-m, --mode <mode>", "compact | full", "compact")
  .option("-d, --depth <n>", "maxDepth", (v) => Number.parseInt(v, 10))
  .option("--filter-role <role>", "filtrar por role canónico")
  .option("--filter-name <text>", "filtrar por nombre (contiene)")
  .option("--headed", "abrir el navegador visible en vez de headless", false)
  .action(
    async (
      target: string,
      opts: { mode: "compact" | "full"; depth?: number; filterRole?: string; filterName?: string; headed: boolean },
    ) => {
      const snapshot = await withBackend(target, opts.headed, (session) =>
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
  .action(async (target: string, query: string, opts: { role?: string; headed: boolean }) => {
    const predicate: Predicate = opts.role
      ? { kind: "and", all: [{ kind: "role", role: opts.role as never }, { kind: "nameContains", text: query }] }
      : { kind: "nameContains", text: query };
    const matches = await withBackend(target, opts.headed, (session) => session.find(predicate));
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
  .action(
    async (
      target: string,
      verb: string,
      opts: { find: string; role?: string; value?: string; headed: boolean },
    ) => {
      const predicate: Predicate = opts.role
        ? { kind: "and", all: [{ kind: "role", role: opts.role as never }, { kind: "nameContains", text: opts.find }] }
        : { kind: "nameContains", text: opts.find };

      const result = await withBackend(target, opts.headed, async (session) => {
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
