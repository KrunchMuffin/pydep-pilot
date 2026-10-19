"""Build tiny offline wheels for the extension's uv integration tests."""
from pathlib import Path
import sys
from zipfile import ZipFile

root = Path(sys.argv[1]) / "wheels"
root.mkdir()
for version in ("1.0.0", "2.0.0"):
    name = f"pydep_test_package-{version}"
    with ZipFile(root / f"{name}-py3-none-any.whl", "w") as wheel:
        wheel.writestr("pydep_test_package/__init__.py", f'__version__ = "{version}"\n')
        wheel.writestr(f"{name}.dist-info/METADATA", f"Metadata-Version: 2.1\nName: pydep-test-package\nVersion: {version}\n")
        wheel.writestr(f"{name}.dist-info/WHEEL", "Wheel-Version: 1.0\nGenerator: pydep-test\nRoot-Is-Purelib: true\nTag: py3-none-any\n")
        record = f"{name}.dist-info/RECORD"
        wheel.writestr(record, "\n".join(f"{file},," for file in [*wheel.namelist(), record]) + "\n")
