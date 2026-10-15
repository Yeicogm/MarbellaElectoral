"""
run_all.py — Ejecuta el pipeline completo en orden.

Uso: python run_all.py
"""

import subprocess
import sys
from pathlib import Path

SCRIPTS = [
    "01_download.py",
    "02_parse_dat.py",
    "03_load_ine.py",
    "04_join.py",
    "05_normalize.py",
]

ROOT = Path(__file__).resolve().parent


def main():
    for script in SCRIPTS:
        path = ROOT / "scripts" / script
        if not path.exists():
            print(f"❌ No existe {path}")
            sys.exit(1)
        print(f"\n{'=' * 60}")
        print(f"▶ {script}")
        print("=" * 60)
        r = subprocess.run([sys.executable, str(path)], cwd=ROOT)
        if r.returncode != 0:
            print(f"\n❌ Error en {script} (código {r.returncode})")
            sys.exit(r.returncode)
    print("\n✅ Pipeline completo. Datos en web/data/")


if __name__ == "__main__":
    main()
