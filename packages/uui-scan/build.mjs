import { readFile } from "node:fs/promises";
import { build } from "esbuild";

/**
 * Empaqueta el workspace en UN solo paquete publicable.
 *
 * Por qué bundling y no publicar los cinco `@uui/*` por separado: el usuario instala
 * `uui-scan`, no un grafo de paquetes internos cuyos límites solo importan a quien
 * desarrolla este repo. Los `workspace:*` además no se pueden publicar tal cual — habría
 * que versionar y publicar cada uno en orden en cada release.
 *
 * Lo que NO se empaqueta (`external`): las dependencias reales de terceros. `playwright`
 * sobre todo — trae binarios de navegador y un instalador propio, así que meterlo en el
 * bundle lo rompería. npm las instala como dependencias normales.
 */
const external = ["playwright", "commander", "zod", "@modelcontextprotocol/sdk"];

// El servidor MCP se anuncia con la versión del paquete. Se inyecta aquí en vez de
// importar el package.json: un import de JSON obligaría a incluirlo en el bundle y a
// mantener sincronizadas dos fuentes de la misma versión.
const { version } = JSON.parse(await readFile(new URL("package.json", import.meta.url), "utf8"));

const comun = {
  define: { __UUI_VERSION__: JSON.stringify(version) },
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  external,
  // Sin `banner` con el shebang: esbuild ya CONSERVA el del archivo de entrada, y añadir
  // otro deja dos — el segundo, a mitad del archivo, es un error de sintaxis.
  logLevel: "info",
};

await Promise.all([
  build({
    ...comun,
    entryPoints: ["../adapter-cli/src/cli.ts"],
    outfile: "dist/cli.js",
  }),
  build({
    ...comun,
    entryPoints: ["../adapter-mcp/src/server.ts"],
    outfile: "dist/mcp.js",
  }),
]);
