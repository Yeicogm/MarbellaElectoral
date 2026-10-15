"""
01_download.py — Descarga los ZIPs de infoelectoral para municipales 2015, 2019, 2023.

API: https://infoelectoral.interior.gob.es/min/
Auth: Basic apiInfoelectoral:apiInfoelectoralPro (credenciales públicas del portal)
"""

import base64
import os
import sys
from pathlib import Path

import requests

# Configuración
API_BASE = "https://infoelectoral.interior.gob.es/min/"
AUTH_USER = "apiInfoelectoral"
AUTH_PASS = "apiInfoelectoralPro"

# Convocatorias a descargar
YEARS = {
    "2015": "201505",
    "2019": "201905",
    "2023": "202305",
}

# Carpeta destino
RAW_DIR = Path(__file__).resolve().parent.parent / "data" / "raw"


def make_auth_header() -> dict:
    """Crea la cabecera de autenticación Basic."""
    token = base64.b64encode(f"{AUTH_USER}:{AUTH_PASS}".encode()).decode()
    return {"Authorization": f"Basic {token}"}


def list_files(year_code: str) -> list[dict]:
    """Lista los archivos disponibles para una convocatoria (municipales)."""
    # tipoConvocatoria=4 = Municipales
    url = f"{API_BASE}archivos/extraccion?tipoConvocatoria=4&idConvocatoria={year_code}"
    r = requests.get(url, headers=make_auth_header(), timeout=30)
    r.raise_for_status()
    return r.json()["data"]


def download_file(url: str, dest: Path) -> None:
    """Descarga un archivo con barra de progreso simple."""
    if dest.exists() and dest.stat().st_size > 1000:
        print(f"  ⏭️  Ya existe: {dest.name}")
        return

    print(f"  ⬇️  Descargando {dest.name}...")
    with requests.get(url, stream=True, timeout=300) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0))
        with open(dest, "wb") as f:
            downloaded = 0
            for chunk in r.iter_content(chunk_size=65536):
                f.write(chunk)
                downloaded += len(chunk)
                if total:
                    pct = 100 * downloaded / total
                    bar = "█" * int(pct / 2) + "░" * (50 - int(pct / 2))
                    print(f"\r  [{bar}] {pct:.1f}%", end="")
        print()
    print(f"  ✓ {dest.name} ({dest.stat().st_size / 1024 / 1024:.2f} MB)")


def main():
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    for year, code in YEARS.items():
        print(f"\n📅 Convocatoria: {year} ({code})")
        try:
            files = list_files(code)
        except Exception as e:
            print(f"  ✗ Error listando archivos: {e}")
            sys.exit(1)

        for f in files:
            if f["descripcion"].endswith("(Mesa)"):
                # Solo descargamos el ZIP "Mesa" (datos por mesa)
                dest = RAW_DIR / f["nombreDoc"]
                download_file(f["url"], dest)
            else:
                print(f"  · Omitido: {f['descripcion']} (usamos solo 'Mesa')")

    print(f"\n✅ Descarga completa. Archivos en: {RAW_DIR}")


if __name__ == "__main__":
    main()
