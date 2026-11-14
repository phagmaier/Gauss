import platform
import tomllib
from pathlib import Path


def test_runs_on_the_python_version_pinned_in_mise_toml():
    """uv can pick another interpreter when run outside mise; fail fast if it did."""
    mise = tomllib.loads((Path(__file__).parents[2] / "mise.toml").read_text())

    assert platform.python_version() == mise["tools"]["python"]
