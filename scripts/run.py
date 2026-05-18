"""Convenience runner so you can `python scripts/run.py` without installing."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from laika.main import run

if __name__ == "__main__":
    run()
