/**
 * Regla dura de la Parte B2 del plan de ejecución: packages/core no puede importar
 * ningún paquete backend-* ni playwright. Este es el mecanismo de control real
 * (§5.2 del plan v2: "la arquitectura del repo es el sistema de control") —
 * las instrucciones al modelo se degradan con la conversación, este gate no.
 */
module.exports = {
  forbidden: [
    {
      name: "core-no-backend-imports",
      comment:
        "packages/core es el motor — no conoce backends concretos. Si esto falla, alguien " +
        "metió una dependencia de backend-web/backend-uia/backend-sap (o playwright) dentro " +
        "de core. Ver ADR-0002-contrato-backend.md.",
      severity: "error",
      from: { path: "^packages/core" },
      to: {
        path: "^packages/backend-|playwright",
      },
    },
    {
      name: "core-no-adapter-imports",
      comment: "core tampoco debe conocer a sus consumidores (CLI, MCP).",
      severity: "error",
      from: { path: "^packages/core" },
      to: { path: "^packages/adapter-" },
    },
    {
      name: "no-circular",
      comment: "Dependencias circulares entre paquetes del workspace.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
