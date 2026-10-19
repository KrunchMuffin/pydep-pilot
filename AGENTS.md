# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Install dependencies
npm install

# Compile TypeScript (one-time)
npm run compile

# Watch mode for development (runs tsc and esbuild in parallel)
npm run watch

# Lint the codebase
npm run lint

# Run extension-host tests (builds and lints first; requires uv and Python)
npm test

# Run standalone backend and localization tests
npm run test:unit

# Package the extension
npm run pack

# Publish to VS Code marketplace
npm run deploy
```

## Testing

Tests run in VS Code's extension host environment with disposable environments and a local wheel index. `npm test` prepares the fixtures. Use the VS Code debugger with "Extension Tests" configuration to run/debug non-mutating tests; uv integration tests skip without the isolated runner. Test files are in `src/test/suite/`.

## Architecture Overview

This is a VS Code extension for managing Python packages via pip or uv pip. It requires the ms-python.python extension as a dependency.

### Dependency Injection System

The codebase uses a custom IoC (Inversion of Control) container adapted from VS Code's core (`src/common/ioc/`). Services are registered with `ServiceCollection` and instantiated via `InstantiationService`.

**Pattern for creating services:**
```typescript
// Define interface and decorator
export interface IMyService { ... }
export const IMyService = createDecorator<IMyService>('myService');

// Implement with static Create factory
export class MyService implements IMyService {
    constructor(@IOtherService private other: IOtherService) { }

    static Create(instantiation: InstantiationService, service?: ServiceCollection) {
        const instance = instantiation.createInstance<IMyService>(this);
        if (service) service.set(IMyService, instance);
        return instance;
    }
}
```

### Core Modules (`src/modules/`)

- **PackageBackend**: Builds pip and uv pip commands targeting the selected Python interpreter
- **PackageManager**: Selects the backend, executes package operations, queries PyPI, and handles source mirror configuration
- **PackageWebviewProvider**: Provides the sidebar package dashboard and merges package info with update availability
- **PythonExtension**: Interfaces with ms-python.python extension to get/watch the active Python interpreter path
- **CommandTool**: Utility for registering VS Code commands with empty placeholder support during initialization

### Internationalization

i18n is handled via `src/common/i18n/` with English defaults. Manifest strings are in `package.nls.json`. The `i18n.localize()` function uses placeholder syntax like `%0%`, `%1%` for string interpolation.

### Path Aliases

TypeScript path alias `@/*` maps to `src/*`. esbuild resolves these when bundling the extension and tests.

### Extension Entry Point

`src/extension.ts` bootstraps the IoC container, waits for Python extension activation, creates all services, and registers VS Code commands for package operations.
