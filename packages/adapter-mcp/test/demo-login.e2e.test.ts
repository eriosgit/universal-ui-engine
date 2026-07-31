import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Demo de salida de F0 (Parte C7 del plan de ejecución): un agente inicia sesión en
 * `fixtures/web-app` usando SOLO las 3 herramientas MCP — sin un selector escrito a
 * mano. Este archivo ES la demo: en vez de (o además de) una grabación de pantalla —que
 * no aporta mucho sobre un Chromium headless manejado por un cliente MCP de línea de
 * comandos— es una prueba automatizada que reproduce exactamente esos pasos y falla si
 * el flujo deja de funcionar. La transcripción de cada llamada MCP se imprime a stdout
 * como evidencia legible (§6: "Demo grabada de la capacidad nueva").
 *
 * El "agente" aquí es deliberadamente tonto: solo sabe llamar a ui.snapshot/ui.find/
 * ui.act con lenguaje natural sobre nombres accesibles ("Usuario", "Contraseña",
 * "Entrar") — nunca un selector CSS/XPath escrito a mano.
 */

const FIXTURE_URL = pathToFileURL(
  resolve(import.meta.dirname, "../../../fixtures/web-app/index.html"),
).href;

const SERVER_ENTRY = fileURLToPath(
  new URL("../dist/src/server.js", import.meta.url),
);

let client: Client;
let transport: StdioClientTransport;

beforeAll(async () => {
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_ENTRY],
  });
  client = new Client({ name: "demo-agent", version: "0.0.0" });
  await client.connect(transport);
});

afterAll(async () => {
  await client.close();
});

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content;
  if (!Array.isArray(content) || content.length === 0 || content[0]?.type !== "text") {
    throw new Error(`Respuesta MCP inesperada: ${JSON.stringify(result)}`);
  }
  return content[0].text as string;
}

describe("Demo C7 — agente inicia sesión usando solo ui.snapshot/ui.find/ui.act", () => {
  it("lista exactamente las 3 herramientas — ni una más", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["ui.act", "ui.find", "ui.snapshot"]);
    // §5.2 / B2 gate 2: toda herramienta MCP declara su presupuesto de tokens.
    const snapshotTool = tools.find((t) => t.name === "ui.snapshot")!;
    expect(snapshotTool.description).toMatch(/token/i);
  });

  it("completa el login sin un solo selector escrito a mano", async () => {
    const transcript: string[] = [];

    // 1. El agente pide un snapshot compacto para orientarse.
    const initial = await client.callTool({
      name: "ui.snapshot",
      arguments: { target: FIXTURE_URL, mode: "compact" },
    });
    transcript.push(`ui.snapshot({mode:'compact'}) -> ${initial.content ? "ok" : "vacío"}`);
    const initialSnapshot = JSON.parse(textOf(initial)) as { tokenEstimate: number };
    expect(initialSnapshot.tokenEstimate).toBeGreaterThan(0);

    // 2. Encuentra el campo "Usuario" por NOMBRE, no por selector.
    const usernameField = await client.callTool({
      name: "ui.find",
      arguments: { target: FIXTURE_URL, nameContains: "Usuario" },
    });
    const [username] = JSON.parse(textOf(usernameField)) as Array<{ uid: string }>;
    transcript.push(`ui.find({nameContains:'Usuario'}) -> uid=${username?.uid}`);
    expect(username).toBeDefined();

    // 3. Escribe el usuario.
    await client.callTool({
      name: "ui.act",
      arguments: { target: FIXTURE_URL, uid: username!.uid, verb: "setValue", value: "dev2" },
    });
    transcript.push(`ui.act(setValue, 'dev2') -> ok`);

    // 4. Encuentra "Contraseña" por nombre y la escribe.
    const passwordField = await client.callTool({
      name: "ui.find",
      arguments: { target: FIXTURE_URL, nameContains: "Contraseña" },
    });
    const [password] = JSON.parse(textOf(passwordField)) as Array<{ uid: string }>;
    transcript.push(`ui.find({nameContains:'Contraseña'}) -> uid=${password?.uid}`);
    await client.callTool({
      name: "ui.act",
      arguments: { target: FIXTURE_URL, uid: password!.uid, verb: "setValue", value: "Test1234!" },
    });
    transcript.push(`ui.act(setValue, '••••••••') -> ok`);

    // 5. Encuentra el botón "Entrar" por nombre + rol, lo invoca.
    const submit = await client.callTool({
      name: "ui.find",
      arguments: { target: FIXTURE_URL, nameContains: "Entrar", role: "button" },
    });
    const [submitButton] = JSON.parse(textOf(submit)) as Array<{ uid: string; supports: string[] }>;
    transcript.push(`ui.find({nameContains:'Entrar', role:'button'}) -> uid=${submitButton?.uid}`);
    expect(submitButton?.supports).toContain("invoke");

    const actResult = await client.callTool({
      name: "ui.act",
      arguments: { target: FIXTURE_URL, uid: submitButton!.uid, verb: "invoke" },
    });
    transcript.push(`ui.act(invoke) -> ${textOf(actResult)}`);

    // 6. Verifica el resultado — de nuevo, encontrando por NOMBRE, no por selector.
    const status = await client.callTool({
      name: "ui.find",
      arguments: { target: FIXTURE_URL, nameContains: "Sesión iniciada" },
    });
    const [statusNode] = JSON.parse(textOf(status)) as Array<{ name: string }>;
    transcript.push(`ui.find({nameContains:'Sesión iniciada'}) -> name="${statusNode?.name}"`);

    console.log(`\n--- Transcripción de la demo C7 ---\n${transcript.join("\n")}\n`);

    expect(statusNode?.name).toBe("Sesión iniciada como dev2");
  });
});
