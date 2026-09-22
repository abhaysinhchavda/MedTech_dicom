# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Troubleshooting

**Blank page, every `@cornerstonejs/*` import throws `TypeError: Class extends value undefined is not a constructor or null` (dev and production build).**

Root cause: `@kitware/vtk.js` (a dependency of `@cornerstonejs/core`) pulls in `xmlbuilder2`, whose `XMLBuilderCBImpl extends EventEmitter` from Node's `events` module. Vite stubs bare Node builtins as empty modules for the browser, so `EventEmitter` was `undefined` at class-definition time. This was not caused by the Vite/Rolldown version, the wasm codec packages, or `optimizeDeps` config — all were ruled out.

Fix: added the `events` package as an explicit dependency and aliased it in `vite.config.ts` (`resolve: { alias: { events: 'events/events.js' } }`) so the real userland `EventEmitter` polyfill resolves in the browser instead of Vite's empty Node-builtin stub. `@cornerstonejs/metadata`, `@cornerstonejs/utils`, and `@testing-library/dom` were also added as explicit dependencies (previously implicit peer/transitive deps).

## Sample data credits

v1 is brain-focused: both bundled sample series are brain MR from the same
UPENN-GBM patient.

- UPENN-GBM (CC BY 4.0) — https://doi.org/10.7937/TCIA.709X-DN49

Data courtesy of The Cancer Imaging Archive (TCIA).
