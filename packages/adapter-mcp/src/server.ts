#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ROLES, Session, type Predicate } from "@uui/core";
import {
  WebBackend,
  defaultProfileDir,
  openPersistentContext,
  type BrowserContext,
} from "@uui/backend-web";

/**
 * Servidor MCP (stdio) — Parte C6 del plan de ejecución. EXACTAMENTE tres herramientas:
 * `ui.snapshot`, `ui.find`, `ui.act`. Traducción fina sobre `@uui/core` — cero lógica de
 * dominio propia (eso vive en `Session`/`resolver`/`serialize`, ya probado en `core`).
 *
 * Sesiones de navegador: TODO corre sobre el perfil persistente (~/.uui/profile, o
 * UUI_PROFILE_DIR) — si el usuario ya inició sesión en una app (vía `uui login`), el
 * agente ve SU dashboard, no la página de login que vería un navegador limpio. Un solo
 * contexto de navegador compartido (el perfil solo admite un proceso a la vez) con una
 * página + `Session` por `target`: así un `uid` devuelto por `ui.snapshot`/`ui.find`
 * sigue siendo válido para un `ui.act` posterior en la misma conversación (D1).
 */

const sessions = new Map<string, Session>();
let sharedContext: BrowserContext | null = null;

async function getSession(target: string): Promise<Session> {
  const existing = sessions.get(target);
  if (existing) return existing;
  if (!sharedContext) {
    sharedContext = await openPersistentContext(defaultProfileDir(), { headless: true });
  }
  const page = await sharedContext.newPage();
  await page.goto(target);
  // fromPage: dispose() de esta Session NO cierra el contexto compartido — las páginas
  // de otros targets siguen vivas. El contexto muere con el proceso del servidor.
  const session = new Session(WebBackend.fromPage(page));
  sessions.set(target, session);
  return session;
}

const RoleEnum = z.enum(ROLES);

const server = new McpServer({ name: "uui-mcp", version: "0.0.0" });

server.registerTool(
  "ui.snapshot",
  {
    title: "Snapshot de una región de UI",
    description:
      "Devuelve el árbol de UI de una región acotada (nunca el árbol completo — D2). " +
      "Presupuesto de tokens objetivo: <3.000 en modo 'compact' para una región " +
      "razonablemente acotada con root/maxDepth/filter (§3 del plan) — el campo " +
      "tokenEstimate de la respuesta lo confirma en cada llamada. Un target grande sin " +
      "acotar puede exceder ese objetivo a propósito: acota con maxDepth o filter antes " +
      "de pedir de nuevo.",
    inputSchema: {
      target: z.string().describe("URL http:// o file:// del documento a inspeccionar"),
      mode: z.enum(["compact", "full"]).optional().default("compact"),
      root: z.string().optional().describe("uid de un nodo devuelto antes, para anclar la región"),
      maxDepth: z.number().int().min(0).optional(),
      filterRole: RoleEnum.optional(),
      filterNameContains: z.string().optional(),
    },
  },
  async ({ target, mode, root, maxDepth, filterRole, filterNameContains }) => {
    const session = await getSession(target);
    const snapshot = await session.snapshot({
      mode,
      root,
      maxDepth,
      filter:
        filterRole || filterNameContains
          ? { role: filterRole, nameContains: filterNameContains }
          : undefined,
    });
    return { content: [{ type: "text", text: JSON.stringify(snapshot, jsonReplacer) }] };
  },
);

server.registerTool(
  "ui.find",
  {
    title: "Buscar nodos por rol y/o nombre",
    description:
      "Busca nodos con un predicado DETERMINISTA (role/nameContains — D7): mismo " +
      "predicado, mismo resultado. Devuelve los uid necesarios para ui.act; nunca " +
      "expone locators internos (D1).",
    inputSchema: {
      target: z.string().describe("URL http:// o file:// del documento a inspeccionar"),
      nameContains: z.string().optional().describe("el nombre accesible debe contener este texto"),
      role: RoleEnum.optional().describe("role canónico exacto"),
    },
  },
  async ({ target, nameContains, role }) => {
    const session = await getSession(target);
    const clauses: Predicate[] = [];
    if (role) clauses.push({ kind: "role", role });
    if (nameContains) clauses.push({ kind: "nameContains", text: nameContains });
    if (clauses.length === 0) {
      throw new Error("ui.find requiere al menos uno de: role, nameContains.");
    }
    const predicate: Predicate = clauses.length === 1 ? clauses[0]! : { kind: "and", all: clauses };
    const matches = await session.find(predicate);
    return { content: [{ type: "text", text: JSON.stringify(matches, jsonReplacer) }] };
  },
);

server.registerTool(
  "ui.act",
  {
    title: "Ejecutar un verbo sobre un nodo",
    description:
      "Ejecuta un verbo (invoke/setValue/toggle/expand/select/focus/scrollIntoView) " +
      "sobre el nodo identificado por `uid` (de un ui.snapshot/ui.find previo EN ESTA " +
      "MISMA conversación). Re-resuelve el fingerprint antes de actuar (D1) — nunca usa " +
      "un handle en caché. Rechaza explícito si el nodo no declaró soportar el verbo (D6).",
    inputSchema: {
      target: z.string().describe("el mismo target usado para obtener el uid"),
      uid: z.string(),
      verb: z.enum(["invoke", "setValue", "toggle", "expand", "select", "focus", "scrollIntoView"]),
      value: z.string().optional().describe("valor para setValue"),
    },
  },
  async ({ target, uid, verb, value }) => {
    const session = await getSession(target);
    const result = await session.act(uid, verb, value !== undefined ? { value } : undefined);
    return { content: [{ type: "text", text: JSON.stringify(result, jsonReplacer) }] };
  },
);

function jsonReplacer(_key: string, value: unknown): unknown {
  return value instanceof Set ? [...value] : value;
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
