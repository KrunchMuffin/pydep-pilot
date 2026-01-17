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
- Python with pip installed

## Installation

1. Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=DABWorx.pydep-pilot)
2. Or search for "PyDepPilot" in the VS Code Extensions view

## Usage

1. Click the PyDepPilot icon in the Activity Bar (left sidebar)
2. View your installed packages with their versions
3. Select packages with checkboxes to bulk update
4. Use the toolbar buttons to add packages, search PyPI, refresh, or export

## Configuration

Access settings via `File > Preferences > Settings` and search for "PyDepPilot":

| Setting | Description | Default |
|---------|-------------|---------|
| `pydep-pilot.source` | PyPI mirror source | `pypi` |
| `pydep-pilot.sourceCustom` | Custom mirror URL (overrides source) | `` |

## Roadmap

- [ ] UV package manager support
- [ ] Poetry support
- [ ] Virtual environment management
- [ ] Dependency tree visualization

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

[GitHub Repository](https://github.com/KrunchMuffin/pydep-pilot)

## License

MIT

## Acknowledgments

Originally forked from [pip-manager](https://github.com/slightc/pip-manager) by slightc. Completely rewritten with a modern webview UI and enhanced features.
