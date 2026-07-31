import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Playwright navega directo a `file://` — no hace falta un servidor HTTP para las
 * pruebas automatizadas (el servidor de `fixtures/web-app/serve.mjs` es solo para la
 * demo manual de CLI/MCP, ver C7).
 */
const FIXTURE_PATH = resolve(import.meta.dirname, "../../../fixtures/web-app/index.html");
export const FIXTURE_URL = pathToFileURL(FIXTURE_PATH).href;
