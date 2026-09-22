import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from tests.conftest import make_ct_series, write_series  # noqa: E402

out = Path(os.environ["SAMPLES_DIR"]) / "e2e-ct"
if not out.exists():
    write_series(make_ct_series(40, rows=64, cols=64, spacing=(1.0, 1.0, 1.0)), out)
print(f"seeded {out}")
