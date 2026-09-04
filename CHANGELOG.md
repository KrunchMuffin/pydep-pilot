# Change Log

All notable changes to PyDepPilot will be documented in this file.

## [1.1.0] - 2026-09-03

### Added
- uv support: package operations run through `uv pip` for environments created by uv when uv is on PATH. New `pydep-pilot.packageManager` setting (`auto`, `pip`, `uv`). The sidebar footer shows the active backend.

### Changed
- Dev dependencies updated (eslint 10, mocha 12, esbuild 0.28, @vscode/test-electron 3). Stale npm overrides removed.

## [1.0.6] - 2026-05-29

### Changed
- Detect folders that do not look like Python projects and show an explicit empty state instead of silently listing unrelated packages.
- Add an intentional "Use Global Interpreter" action when a project environment is not available.

## [1.0.5] - 2026-05-29

### Changed
- Replace the extension artwork with a simpler PDP cube Marketplace icon and a matching simplified cube sidebar icon.

## [1.0.4] - 2026-05-29

### Fixed
- Scope package lists to the current workspace's Python environment instead of falling back to another workspace or global interpreter.
- Show a project-environment empty state when no local or workspace-scoped interpreter is available.
- Install requirements using the selected requirements file's directory as the pip working directory.
- Update runtime and development dependencies, remove redundant glob type stubs, and resolve npm audit advisories.

## [1.0.0] - 2025-01-16

Initial release of PyDepPilot.

### Features
- **Modern Webview UI**: Clean, responsive interface for managing Python packages
- **Progressive Loading**: Shows package list immediately while checking for updates in background
- **Version Picker**: Click on current version to select and install a different version
- **Bulk Updates**: Select multiple packages and update them all at once
- **Export Requirements**: Export installed packages to requirements.txt
- **Search PyPI**: Search and install packages directly from PyPI
- **Visual Status Indicators**: Clear badges showing up-to-date vs outdated packages
- **Filter/Search**: Quickly filter your installed packages by name
- **Custom PyPI Mirror**: Option to use a custom PyPI mirror URL
