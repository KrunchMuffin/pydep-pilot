# uv backend for PyDepPilot

Date: 2026-09-03
Status: phase 1 implemented, phase 2 designed only

## Goal

Let PyDepPilot manage packages through `uv` as well as `pip`, so users of
uv-created environments get uv's speed and the marketplace `uv` keyword is
honoured. The sidebar's mental model stays the same: it shows what is
installed in the selected interpreter's environment.

## Phase 1: uv as a pip-compatible backend (this change)

### Behaviour

- New setting `pydep-pilot.packageManager` with values `auto`, `pip`, `uv`.
  Default `auto`.
- `auto` picks uv when both are true: the `uv` executable is on PATH, and the
  selected interpreter lives in an environment whose `pyvenv.cfg` carries a
  `uv = <version>` line (uv writes that line into every venv it creates).
  Otherwise pip. This keeps existing pip users unaffected: an environment
  made by `python -m venv`, conda, or the system interpreter never switches.
- `uv` forces uv. If uv is not on PATH the extension warns once and falls
  back to pip rather than failing every operation.
- `pip` forces pip, which is exactly today's behaviour.
- The webview footer shows the active backend next to the package count.
- The output channel logs which backend was chosen and why.

### Command mapping

| Operation | pip | uv |
|---|---|---|
| list | `python -m pip list --format json` | `uv pip list --format json --python <py>` |
| outdated | `... list --outdated --format json -i <index>` | `uv pip list --outdated --format json --default-index <index> --python <py>` |
| freeze | `python -m pip freeze` | `uv pip freeze --python <py>` |
| install / upgrade | `... install -U <spec> -i <index>` | `uv pip install -U <spec> --default-index <index> --python <py>` |
| requirements | `... install -U -r <file> -i <index>` | `uv pip install -U -r <file> --default-index <index> --python <py>` |
| uninstall | `... uninstall <name> -y` | `uv pip uninstall <name> --python <py>` |

Verified against uv 0.8.22: the JSON shapes for list and outdated match pip's
(`name`, `version`, `latest_version`), uv's "Using Python ..." banner goes to
stderr so stdout parses cleanly, and uv rejects a repeated `--upgrade` flag,
so the update path now sends `-U` once for both backends.

### Structure

- `src/modules/PackageBackend.ts`: pure command builders for both backends plus
  the `pyvenv.cfg` detection helpers. No VS Code imports, so it is unit
  testable.
- `src/modules/PackageManager.ts`: resolves the backend (setting, uv on PATH,
  pyvenv.cfg) and routes every subprocess call through it. Exposes
  `getActiveBackend()` on `IPackageManager`.
- `src/modules/PackageWebviewProvider.ts` and `media/webview/main.js`: pass the
  backend name to the webview and render it in the footer.
- `package.json` and `package.nls.json`: the setting.

### Error handling

- uv missing while forced: one warning per session, then pip.
- uv cannot find the interpreter: uv exits 2 with a clear message; it surfaces
  through the existing error path unchanged.
- Backend resolution failures never block listing: any exception in detection
  resolves to pip.

### Testing

- `src/test/suite/backend.test.ts`: command shapes for both backends,
  `pyvenv.cfg` detection, and the cfg path derivation on Windows and POSIX
  layouts.
- `src/test/suite/pip.test.ts`: `getActiveBackend()` resolves to a known value.
- Manual: the smoke test above against a uv venv and a stdlib venv.

## Phase 2: uv project mode (not built, designed for later)

For a workspace with `pyproject.toml` and `uv.lock`, users expect the
extension to edit declared dependencies rather than install into
site-packages, because `uv pip install` in such a project silently bypasses
the lockfile.

Decisions taken now so phase 2 has a fixed target:

- Detection: `uv.lock` in the preferred workspace folder and uv on PATH.
- Actions map to `uv add <spec>`, `uv remove <name>`, and for updates
  `uv lock --upgrade-package <name>` followed by `uv sync`. Updates refresh the
  lock and do not rewrite the constraint in `pyproject.toml`; rewriting
  constraints is a policy choice the user should make by editing the file.
- The sidebar keeps showing the installed environment. Project mode changes
  what the add, remove, and update buttons run, and labels the footer
  `uv project`. Pip-style actions are hidden in project mode, not offered
  alongside, to avoid the lock-bypass footgun.
- The requirements.txt install command stays pip-style in every mode.

This needs its own spec section for the webview changes and a decision on how
to present dependency groups (dev, optional extras) before implementation.
