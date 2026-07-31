import type { Flow, FlowStep, Predicate } from "@uui/core";
import { describePredicate, flatten, quotePy } from "./predicateText.js";

/**
 * Genera un script de Playwright para Python — el target que el plan (§F3) señala como el
 * de retorno de negocio más directo, por encajar con stacks tipo Rocketbot. Igual que el
 * de TypeScript: autónomo, sin `@uui` ni IA en tiempo de ejecución.
 */

function locator(predicate: Predicate): string {
  const f = flatten(predicate);
  if (f.role) {
    const opciones: string[] = [];
    if (f.nameEquals) opciones.push(`name=${quotePy(f.nameEquals)}, exact=True`);
    else if (f.nameContains) opciones.push(`name=${quotePy(f.nameContains)}`);
    return opciones.length > 0
      ? `page.get_by_role(${quotePy(f.role)}, ${opciones.join(", ")})`
      : `page.get_by_role(${quotePy(f.role)})`;
  }
  if (f.nameEquals) return `page.get_by_text(${quotePy(f.nameEquals)}, exact=True)`;
  return `page.get_by_text(${quotePy(f.nameContains ?? "")})`;
}

function first(predicate: Predicate): string {
  return `${locator(predicate)}.first`;
}

function stepCode(step: FlowStep): string[] {
  const comentario = `    # ${step.label ?? step.action}`;
  switch (step.action) {
    case "goto":
      return [comentario, `    page.goto(${quotePy(step.target)})`];

    case "waitForStable":
      return [
        `${comentario} — espera a que el DOM deje de cambiar (ADR-0005)`,
        `    wait_for_stable(page, ${step.quietMs ?? 500}, ${step.timeoutMs ?? 15000})`,
      ];

    case "waitFor":
      return [
        `${comentario} — espera por condición, no por tiempo fijo`,
        `    ${first(step.target)}.wait_for(state="visible"${
          step.timeoutMs ? `, timeout=${step.timeoutMs}` : ""
        })`,
      ];

    case "waitForValue":
      return [
        `${comentario} — espera a que el campo derivado termine de calcularse`,
        step.expect === "equals"
          ? `    expect(${first(step.target)}).to_have_value(${quotePy(step.value ?? "")}${
              step.timeoutMs ? `, timeout=${step.timeoutMs}` : ""
            })`
          : `    expect(${first(step.target)}).not_to_have_value(""${
              step.timeoutMs ? `, timeout=${step.timeoutMs}` : ""
            })`,
      ];

    case "act": {
      const target = first(step.target);
      switch (step.verb) {
        case "invoke":
        case "toggle":
        case "expand":
          return [comentario, `    ${target}.click()`];
        case "setValue":
          return [comentario, `    ${target}.fill(${quotePy(step.value ?? "")})`];
        case "select":
          return [
            comentario,
            step.value !== undefined
              ? `    ${target}.select_option(${quotePy(step.value)})`
              : `    ${target}.click()`,
          ];
        case "focus":
          return [comentario, `    ${target}.focus()`];
        case "scrollIntoView":
          return [comentario, `    ${target}.scroll_into_view_if_needed()`];
      }
      break;
    }

    case "expect": {
      const desc = describePredicate(step.target);
      switch (step.assert) {
        case "exists":
          return [comentario, `    expect(${first(step.target)}).to_be_visible()  # ${desc}`];
        case "notExists":
          return [comentario, `    expect(${locator(step.target)}).to_have_count(0)  # ${desc}`];
        case "count":
          return [
            comentario,
            `    expect(${locator(step.target)}).to_have_count(${step.count ?? 0})  # ${desc}`,
          ];
        case "nameEquals":
          return [
            comentario,
            `    expect(${first(step.target)}).to_have_text(${quotePy(step.value ?? "")})  # ${desc}`,
          ];
        case "nameContains":
          return [
            comentario,
            `    expect(${first(step.target)}).to_contain_text(${quotePy(step.value ?? "")})  # ${desc}`,
          ];
      }
      break;
    }

    case "extract":
      return [
        comentario,
        `    datos[${quotePy(step.name)}] = ${first(step.target)}.${
          step.field === "value" ? "input_value()" : "text_content()"
        }`,
      ];
  }
  return [comentario, "    # (paso no soportado por este generador)"];
}

/**
 * `waitForStable` (ADR-0005) en Python. Misma semántica que en el target TS: "nada cambió
 * en el DOM durante `quiet_ms` seguidos", medido con un `MutationObserver`, porque en el
 * script generado no existe el árbol universal del motor.
 */
const WAIT_FOR_STABLE_PY = [
  "def wait_for_stable(page, quiet_ms, timeout_ms):",
  '    """Espera a que el DOM deje de cambiar durante quiet_ms seguidos."""',
  "    page.evaluate(",
  '        """([quiet, limite]) => new Promise((resolve, reject) => {',
  "            let timer;",
  "            let vencimiento;",
  "            function listo() {",
  "                observer.disconnect();",
  "                clearTimeout(timer);",
  "                clearTimeout(vencimiento);",
  "                resolve();",
  "            }",
  "            const observer = new MutationObserver(() => {",
  "                clearTimeout(timer);",
  "                timer = setTimeout(listo, quiet);",
  "            });",
  "            vencimiento = setTimeout(() => {",
  "                observer.disconnect();",
  "                clearTimeout(timer);",
  "                reject(new Error(",
  "                    `El DOM siguió cambiando durante ${limite}ms sin quedarse quieto ${quiet}ms seguidos.`",
  "                ));",
  "            }, limite);",
  "            observer.observe(document, {",
  "                childList: true, subtree: true, attributes: true, characterData: true",
  "            });",
  "            timer = setTimeout(listo, quiet);",
  '        })""",',
  "        [quiet_ms, timeout_ms],",
  "    )",
  "",
  "",
];

export function generatePlaywrightPy(flow: Flow, options: { headless?: boolean } = {}): string {
  // Solo se emite si el flujo lo usa: nada de código muerto en el script generado.
  const usaEstabilidad = flow.steps.some((step) => step.action === "waitForStable");
  return [
    "# Generado por `uui codegen` a partir de un flujo de Universal UI Engine.",
    `# Flujo: ${flow.name}${flow.description ? ` — ${flow.description}` : ""}`,
    "#",
    "# Script AUTÓNOMO: no depende de @uui ni de una IA para ejecutarse.",
    "# Requiere: pip install playwright && playwright install chromium",
    "",
    "import json",
    "import os",
    "from pathlib import Path",
    "from playwright.sync_api import sync_playwright, expect",
    "",
    "# Sesión: reutiliza el MISMO perfil persistente con el que se descubrió el flujo",
    "# (`uui login`), así que una app autenticada funciona sin volver a iniciar sesión.",
    'PROFILE_DIR = os.environ.get("UUI_PROFILE") or str(Path.home() / ".uui" / "profile")',
    "",
    "",
    ...(usaEstabilidad ? WAIT_FOR_STABLE_PY : []),
    "def main():",
    "    datos = {}",
    "    with sync_playwright() as p:",
    `        browser = p.chromium.launch_persistent_context(PROFILE_DIR, headless=${options.headless === false ? "False" : "True"})`,
    "        page = browser.pages[0] if browser.pages else browser.new_page()",
    "        try:",
    // `stepCode` emite con 4 espacios de base; dentro de `with` + `try` el cuerpo va a 12,
    // así que hay que añadir 8, no 4. (Python no perdona esto: un nivel de más y el
    // `finally` deja de emparejar con su `try`.)
    ...flow.steps.flatMap(stepCode).map((line) => `        ${line}`),
    "        finally:",
    "            browser.close()",
    "    print(json.dumps(datos, indent=2, ensure_ascii=False))",
    "    return datos",
    "",
    "",
    'if __name__ == "__main__":',
    "    main()",
    "",
  ].join("\n");
}
