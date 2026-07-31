import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ejecutar = promisify(execFile);

/**
 * Prueba el BUNDLE, no el código fuente.
 *
 * Es la diferencia que importa: `pnpm test` puede estar verde y el paquete publicado
 * seguir roto por algo que solo existe al empaquetar — un shebang duplicado, una
 * dependencia que quedó fuera del bundle, un `import` de Node que esbuild no resolvió.
 * Eso no lo ve ningún test de `src/`; lo ve el usuario al hacer `npx uui-scan`.
 */

const RAIZ = resolve(import.meta.dirname, "..");
const CLI = resolve(RAIZ, "dist/cli.js");
const MCP = resolve(RAIZ, "dist/mcp.js");
const FIXTURE = pathToFileURL(resolve(RAIZ, "../../fixtures/web-app/index.html")).href;
const SALIDA = resolve(RAIZ, "test/.tmp-scan");

beforeAll(async () => {
  // El bundle tiene que existir: lo produce `pnpm build:pkg`, que corre en `verify`.
  await readFile(CLI, "utf8");
}, 30_000);

afterAll(async () => {
  await rm(SALIDA, { recursive: true, force: true });
});

describe("bundle de uui-scan", () => {
  it("los dos binarios arrancan con UN solo shebang, en la primera línea", async () => {
    for (const archivo of [CLI, MCP]) {
      const contenido = await readFile(archivo, "utf8");
      const lineas = contenido.split("\n");
      expect(lineas[0]).toBe("#!/usr/bin/env node");
      // Un segundo shebang a mitad de archivo es un SyntaxError, no un comentario.
      expect(contenido.split("#!/usr/bin/env node")).toHaveLength(2);
    }
  });

  it("`scan` produce el catálogo de selectores del formulario", async () => {
    const { stdout } = await ejecutar(
      process.execPath,
      [CLI, "scan", FIXTURE, "--clean", "--filter-role", "form"],
      { maxBuffer: 10 * 1024 * 1024 },
    );

    expect(stdout).toContain("| Campo | id | name | tipo | req | selector |");
    expect(stdout).toContain("| Usuario | username | username | textbox |");
    expect(stdout).toContain("`login-username` (testId)");
    // Las coordenadas nunca deben llegar a un catálogo.
    expect(stdout).not.toContain("(coords)");
    // Ni el separador interno del locator role+name.
    expect(stdout).not.toContain("\u0000");
  }, 120_000);

  it("`--out` escribe el .json y el .md, y el JSON es parseable", async () => {
    await ejecutar(
      process.execPath,
      [CLI, "scan", FIXTURE, "--clean", "--filter-role", "form", "--out", SALIDA, "--name", "login"],
      { maxBuffer: 10 * 1024 * 1024 },
    );

    const catalogo = JSON.parse(await readFile(resolve(SALIDA, "login.json"), "utf8"));
    expect(catalogo.groups[0].fields.map((f: { name: string }) => f.name)).toEqual([
      "Usuario",
      "Contraseña",
    ]);
    expect(catalogo.scannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const md = await readFile(resolve(SALIDA, "login.md"), "utf8");
    expect(md).toContain("# Escaneo de UI");
  }, 120_000);

  it("colapsa la tabla de 20 filas en una sola entrada parametrizada", async () => {
    const { stdout } = await ejecutar(
      process.execPath,
      [CLI, "scan", FIXTURE, "--clean"],
      { maxBuffer: 10 * 1024 * 1024 },
    );

    expect(stdout).toContain("Editar ×20");
    expect(stdout).toContain("tr:nth-child({n})");
    // Sin colapso salían 20 filas de ~200 caracteres cada una.
    expect(stdout.match(/\| Editar/g) ?? []).toHaveLength(1);
  }, 120_000);
});
