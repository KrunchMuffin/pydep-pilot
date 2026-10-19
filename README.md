[github-shield]: https://img.shields.io/github/stars/KrunchMuffin/pydep-pilot?style=social
[github-url]: https://github.com/KrunchMuffin/pydep-pilot
[vscode-shield]: https://img.shields.io/visual-studio-marketplace/i/DABWorx.pydep-pilot?logo=visual-studio-code&style=social
[vscode-url]: https://marketplace.visualstudio.com/items?itemName=DABWorx.pydep-pilot

[![VSCode Plugin][vscode-shield]][vscode-url]
[![Github Repo][github-shield]][github-url]

# PyDepPilot

A modern, intuitive Python dependency manager for VS Code. View your installed packages, check for updates at a glance, and bulk update with ease.

## Features

### Interactive Package Dashboard

View all your installed Python packages in a clean, modern webview interface with real-time update checking.

<!-- TODO: Add screenshot of main interface -->
![Package Dashboard](https://github.com/KrunchMuffin/pydep-pilot/raw/main/doc/img/dashboard.webp)

### Version Management

- See **installed version** and **latest version** side by side
- Visual indicators for outdated packages
- Click any version to pick a specific version to install

<!-- TODO: Add screenshot showing version columns -->
![Version Display](https://github.com/KrunchMuffin/pydep-pilot/raw/main/doc/img/versions.webp)

### Bulk Update

Select multiple packages and update them all at once. No more updating one by one!

<!-- TODO: Add GIF of bulk update in action -->
![Bulk Update](https://github.com/KrunchMuffin/pydep-pilot/raw/main/doc/img/bulk-update.gif)

### Search PyPI

Search for packages on PyPI directly from VS Code. The search opens pypi.org in your browser where you can browse results and find the exact package you need.

> **Note:** VS Code will prompt you to allow opening the external URL the first time. Click "Open" to proceed.

### Export to requirements.txt

Generate a `requirements.txt` file from your currently installed packages with one click.

### Additional Features

- **Filter packages** - Quickly find packages with the search/filter box
- **Open in PyPI** - Click any package name to view it on PyPI
- **Remove packages** - Easily uninstall packages you no longer need
- **Install from requirements.txt** - Right-click any requirements.txt file to install all packages
- **Custom PyPI mirrors** - Configure alternative package sources (PyPI, Tsinghua, Aliyun, Douban, or custom URL)

## Requirements

- [Python extension for VS Code](https://marketplace.visualstudio.com/items?itemName=ms-python.python) (ms-python.python)
- Python with pip installed, or [uv](https://docs.astral.sh/uv/getting-started/installation/) for the uv backend (pip is not required in uv environments)

## Installation

1. Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=DABWorx.pydep-pilot)
2. Or search for "PyDepPilot" in the VS Code Extensions view

## Usage

1. Click the PyDepPilot icon in the Activity Bar (left sidebar)
2. View packages from the current workspace's Python environment
3. Select packages with checkboxes to bulk update
4. Use the toolbar buttons to add packages, search PyPI, refresh, or export

PyDepPilot prefers a project-local virtual environment such as `.venv`, `venv`, `.env`, or `env`. If no local environment is found, it uses a workspace-scoped interpreter selected through the Python extension. In folders that do not look like Python projects, PyDepPilot shows that state and lets you explicitly choose the selected global interpreter if you want to inspect global packages.

### Using uv

Create an environment with `uv venv`, then open the PyDepPilot sidebar. The default `auto` setting detects uv-created environments and uses `uv pip` when uv is available. The sidebar footer shows which backend is active.

To use uv with an existing Python environment, set `pydep-pilot.packageManager` to `uv`. Install, update, version selection, uninstall, update checks, requirements import, and requirements export all use the selected interpreter through uv's `--python` option. See [uv's environment documentation](https://docs.astral.sh/uv/pip/environments/) for details.

If VS Code cannot find uv, set `pydep-pilot.uvPath` in User Settings to the full executable path (without quotes or arguments). For remote workspaces, set it in Remote Settings on the host running Python. Refresh retries uv detection. If uv is unavailable, PyDepPilot falls back to pip and warns when uv was explicitly selected; that fallback requires pip in the environment.

These operations manage installed packages only. They do not update `pyproject.toml` or `uv.lock`; project commands such as `uv add` and `uv sync` remain outside this backend.

## Configuration

Access settings via `File > Preferences > Settings` and search for "PyDepPilot":

| Setting | Description | Default |
|---------|-------------|---------|
| `pydep-pilot.customPypiUrl` | Custom PyPI/simple index URL | `` |
| `pydep-pilot.packageManager` | `auto`, `pip`, or `uv`. `auto` uses uv for environments uv created when uv is available, otherwise pip | `auto` |
| `pydep-pilot.uvPath` | uv executable name or full path, configured in User or Remote Settings | `uv` |

## Roadmap

- [x] UV package manager support (`uv pip` backend; project mode with `uv add`/`uv sync` planned)
- [ ] Poetry support
- [ ] Virtual environment management
- [ ] Dependency tree visualization

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

Development requires Node.js 22.13 or newer. Run `npm install`, `npm run compile`, and `npm run lint`. `npm run pack` produces a VSIX for local installation.

`npm run test:unit` runs the backend command and localization tests. `npm test` builds and lints the extension, then runs tests in an isolated VS Code extension host. Install uv and Python first. The runner creates temporary environments and serves local test wheels, so package operations do not touch your own environments or depend on PyPI. The first run may download VS Code and the Python extension. Set `VSCODE_TEST_VERSION` to test another VS Code version, `VSCODE_EXECUTABLE_PATH` to use a local copy, or `PYDEP_TEST_UV` to use a specific uv executable.

Dependency updates retain VS Code API types at the minimum supported version (1.108.1) and the stable Codicons release (0.0.45). TypeScript 6 is used because the current typescript-eslint parser does not support TypeScript 7.

Fallow's configuration keeps `@vscode/codicons` because the webview loads its font directly. It also declares `resolveWebviewView` as a framework-invoked method specifically for `IPackageWebviewProvider` implementations. Duplication and complexity checks keep their default thresholds.

[GitHub Repository](https://github.com/KrunchMuffin/pydep-pilot)

## License

MIT

## Acknowledgments

Originally forked from [pip-manager](https://github.com/slightc/pip-manager) by slightc. Completely rewritten with a modern webview UI and enhanced features.
