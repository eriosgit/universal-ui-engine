---
name: code-review
description: Revisión de PR propia de Universal UI Engine. Bloquea el único error que puede matar el proyecto (ramificar el núcleo por identidad de backend) y las tres reglas mínimas de §5.2 del plan. Usar antes de abrir o aprobar cualquier PR que toque packages/core, packages/backend-*, o packages/adapter-*.
---

# code-review — Universal UI Engine

Una skill de code-review genérica comenta nombres de variables. Esta bloquea el PR
cuando alguien mete un `if (backend === 'uia')` dentro de `core` — el error que
`Plan_Desarrollo_Universal_UI_v2.md` §5.2 llama, textualmente, "el único que realmente
puede matar el proyecto". Corre esto ANTES de aprobar cualquier PR, encima de (no en vez
de) los gates mecánicos de CI.

## Antes de revisar nada

```bash
pnpm build && pnpm lint && pnpm deps && pnpm test
```

Si `pnpm lint` o `pnpm deps` fallan, el PR está roto en el nivel más barato de detectar —
no sigas con la revisión manual hasta que estén en verde.

## Checklist (en este orden)

### 1. `packages/core` no ramifica por identidad de backend

`pnpm deps` y la regla ESLint `no-restricted-syntax` ya atrapan `node.backend === '...'`
literal e imports de `backend-*`/`playwright` dentro de `core`. Lo que NO atrapan
mecánicamente — revisar a mano en el diff de `packages/core/**`:

- Duck-typing disfrazado: `if ('page' in backend)`, `if (backend.constructor.name === ...)`,
  `typeof (backend as any).evaluate === 'function'`.
- Un parámetro nuevo en una función de `core` cuyo ÚNICO propósito es distinguir backends
  (`options.isWeb`, `mode: 'web' | 'uia'` en una firma de `core`).
- Comentarios tipo `// esto es específico de Playwright` dentro de `core` — señal de que
  la lógica debería vivir en `backend-web`, no aquí.

Si encuentras algo de esto: **bloquea el PR**. La pregunta correcta que `core` puede
hacerle a un nodo es "¿soportas este verbo?" (`node.supports`, D6) — nunca "¿qué backend
eres?".

### 2. Toda herramienta MCP declara su presupuesto de tokens

Cualquier tool nueva/modificada en `packages/adapter-mcp/src/` debe declarar, en su
descripción (lo que el agente ve), una expectativa de costo — aunque sea aproximada
("snapshot compacto, objetivo <3.000 tokens"). Si el PR agrega o cambia una tool sin esa
declaración: bloquea y pide que se agregue, con referencia a §3 del plan.

### 3. Todo locator nuevo trae caso en golden trees

Si el PR agrega un `LocatorKind` nuevo (`packages/core/src/types.ts`) o cambia cómo un
backend genera/prioriza locators (`resolver.ts::DEGRADATION_TIERS`, o el equivalente de
un backend nuevo): debe venir con un caso nuevo o actualizado en
`packages/*/test/golden/` o `__snapshots__/` que lo ejercite. Un locator sin golden tree
es un locator sin manera barata de detectar su regresión.

### 4. Cambios al modelo o al contrato exigen ADR (§5.5)

Si el diff toca `packages/core/src/types.ts` (el `UINode`) o
`packages/core/src/backend.ts` (la interfaz `Backend`) sin referenciar un ADR nuevo o
existente en `docs/adr/`: bloquea. Estas son, textualmente, decisiones que "no se
delegan a la IA" — un PR que las cambia sin pasar por una decisión explícita del humano
es la señal de alarma más importante que puede aparecer en este proyecto.

### 5. `pageScript.ts` (o el análogo de un backend nuevo) sigue siendo autocontenido

Si el PR toca `packages/backend-web/src/pageScript.ts`: verifica que NINGUNA función o
constante que el código in-page necesite quede declarada fuera de `runInPage` (a nivel de
módulo). Es invisible en el navegador — Playwright serializa la función con `.toString()`.
Este bug real ya ocurrió una vez en F0 (`NAME_FROM_CONTENT_ROLES`); el typecheck NO lo
detecta, solo un test que de verdad ejecuta el backend contra un fixture.

### 6. Ningún test se saltó, se comentó, o se puso en `.only`

Prohibido explícito (§7 del plan). Si un test empezó a fallar por este PR, el problema es
el PR, no el test — arreglar el código, no relajar el assert.

## Al terminar

Si todo lo anterior pasa: aprobar. Si algo se bloqueó: decir explícitamente CUÁL de los 6
puntos falló y por qué, con la línea/archivo exacto — no un comentario genérico.
