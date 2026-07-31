# CLAUDE.md — Universal UI Engine

Instrucciones operativas para trabajar en este repo. La fuente de verdad de la
*estrategia* del proyecto es `Plan_Desarrollo_Universal_UI_v2.md` — documento interno
que vive SOLO en local (está en `.gitignore`, no se versiona); las citas tipo "§5.2 del
plan" en los docs de este repo se refieren a él. El glosario y las invariantes de código
están en `CONTEXT.md`; las decisiones congeladas en `docs/adr/`. Este archivo es el
"cómo se trabaja aquí", no el "qué se está construyendo".

## Comandos

```bash
pnpm install
pnpm build       # tsc -b — construye los 4 paquetes en orden topológico (project refs)
pnpm lint        # eslint . — incluye la regla que bloquea node.backend === '...' en core
pnpm deps        # dependency-cruiser — bloquea que core importe backend-*/playwright
pnpm test        # vitest — unitarias de core + conformidad + golden trees + tokens
pnpm test:tokens # solo el gate de presupuesto de tokens (§3)
pnpm test:golden # solo los golden trees (§6)
pnpm verify      # build && lint && deps && test — lo mismo que corre en CI
```

**Nota:** el script se llama `verify`, no `ci` — `pnpm ci` es un comando INTERNO de pnpm
(equivalente a `npm ci`: borra `node_modules` y reinstala desde el lockfile) que
siempre gana sobre un script con ese nombre, así que un script `"ci"` en package.json
nunca se ejecutaría con `pnpm ci` a secas. Ya nos pasó una vez en F0.

`pnpm build` debe correr ANTES de tocar cualquier paquete downstream de `@uui/core`: con
project references, `tsc -b` de `backend-web`/`adapter-*` necesita los `.d.ts` ya emitidos
de `core`.

## El bucle de trabajo (§5.4 del plan)

1. Si hay una decisión arquitectónica real en juego, ciérrala con el usuario ANTES de
   escribir código (grilling) — no se infiere "lo que probablemente debería hacer".
2. Spec en `docs/specs/NNNN-*.md`; si hay decisión arquitectónica → ADR en `docs/adr/`.
3. TDD: rojo → verde → refactor. La suite de conformidad (`packages/core/conformance/`)
   se escribe ANTES del segundo backend, no después — si no, describe lo que los
   backends ya hacen en vez de lo que el contrato exige.
4. `pnpm verify` en verde antes de dar algo por terminado.
5. Registrar en el ADR/spec los callejones sin salida encontrados implementando (ver
   ADR-0001 y ADR-0002 — varios defectos reales se descubrieron ASÍ, no en el diseño).

## Qué NO se decide sin el humano (§5.5 del plan)

- Cambios al Modelo Universal de UI (`packages/core/src/types.ts`) — requieren ADR.
- Cambios al contrato `Backend` (`packages/core/src/backend.ts`).
- El modelo de seguridad / qué cuenta como acción destructiva.
- Agregar un backend nuevo.

## Convenciones de Git (§5.3)

- Trunk-based, ramas cortas (`feat/f0-...`). Nunca commitear directo a `main`.
- Un commit por unidad de trabajo cerrada, Conventional Commits, cuerpo con el *por qué*.
- Nunca `git add -A` — enumerar archivos explícitamente.
- Nunca `--force`, `reset --hard`, ni reescritura de historia en ramas compartidas.
- El agente abre PR, no hace merge a `main`.

## Prohibido (§7)

- `git push`/merge a `main`.
- Modificar `.env`/secretos.
- Modificar o borrar un test que ya pasaba para poner la suite en verde.
- Dejar tests con `.skip`/`.only`/comentados.
- Ejecutar contra una base de datos o entorno que no sea el declarado para pruebas.

## Particularidad de este repo: `pageScript.ts`

Todo el contenido de `packages/backend-web/src/pageScript.ts` corre DENTRO del navegador
vía `page.evaluate(fn, args)`. Playwright serializa `fn` con `.toString()` — cualquier
función o constante que ese código necesite debe estar declarada DENTRO de la función
exportada (`runInPage`), nunca a nivel de módulo. Un closure de módulo es invisible en el
contexto aislado del navegador; esto ya causó un bug real en la implementación de F0
(`NAME_FROM_CONTENT_ROLES` declarada fuera → `ReferenceError` en tiempo de ejecución,
capturado por la suite de conformidad, no por el typecheck).
