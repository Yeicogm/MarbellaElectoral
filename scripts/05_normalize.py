"""
05_normalize.py — Normaliza los nombres de candidaturas entre años y asigna colores.

Las siglas de los partidos pueden cambiar entre años (p.ej. "PSOE" vs "PSOE-A", "PODEMOS" vs "PODEMOS-IU").
Este script crea un mapeo canónico y aplica la misma paleta de colores a todas las
convocatorias para que las comparativas entre años sean consistentes.
"""

import json
from pathlib import Path
import re

PROC_DIR = Path(__file__).resolve().parent.parent / "data" / "processed"
WEB_DATA_DIR = Path(__file__).resolve().parent.parent / "web" / "data"

YEARS = ["2015", "2019", "2023"]

# Paleta canónica por siglas. Las claves son las siglas "oficiales" que usaremos.
# Los valores son colores hex.
PALETTE = {
    "PP":            "#1d4ed8",   # azul
    "PSOE":          "#dc2626",   # rojo
    "PSOE-A":        "#dc2626",   # mismo rojo (variante andaluza)
    "VOX":           "#16a34a",   # verde
    "Cs":            "#f59e0b",   # naranja
    "PODEMOS":       "#7c3aed",   # morado
    "ADELANTE":      "#7c3aed",   # morado (coalición con Podemos)
    "IU":            "#7c3aed",   # morado (IU)
    "UPyD":          "#a3e635",   # verde lima
    "POR MI PUEBLO": "#0891b2",   # turquesa (partido local)
    "PMP":           "#0891b2",
    "OSP":           "#a16207",   # marrón (partido local)
    "OPCION SAMPEDREÑA": "#a16207",
    "IMPULSA CIUDAD": "#db2777",  # rosa
    "CSSPTT":        "#7c3aed",   # Costa del Sol Sí Puede → Podemos
    "PA":            "#0d9488",   # Partido Andalucista
    "MAREA":         "#0e7490",
    "EQUO":          "#65a30d",
    "VERDES":        "#65a30d",
    "OTROS":         "#6b7280",   # gris
}


def canonicalize(siglas: str, denominacion: str) -> str:
    """Devuelve las siglas canónicas para normalizar entre años."""
    s = (siglas or "").upper().strip()
    d = (denominacion or "").upper()

    # PP
    if "POPULAR" in d or s in ("PP", "P.P."):
        return "PP"

    # PSOE (cualquier variante)
    if "PSOE" in s or "SOCIALISTA" in d:
        if "ANDALUC" in d or s.endswith("-A"):
            return "PSOE-A"
        return "PSOE"

    # VOX
    if s == "VOX" or s.startswith("VOX"):
        return "VOX"

    # Ciudadanos
    if "CIUDADANOS" in d or s in ("CS", "C'S", "CIUDADANOS"):
        return "Cs"

    # Podemos y variantes locales
    if "PODEMOS" in s or "PODEMOS" in d:
        return "PODEMOS"
    if "COSTA DEL SOL" in d or "CSSPTT" in s or "SI PUEDE" in d:
        return "CSSPTT"  # variante local de Podemos
    if "ADELANTE" in s or "ADELANTE" in d:
        return "ADELANTE"
    if s == "IU" or "IZQUIERDA UNIDA" in d or "IULV" in s:
        return "IU"
    if "UPYD" in s or "PROGRESO Y DEMOCRACIA" in d:
        return "UPyD"

    # Partidos locales Marbella
    if "POR MI PUEBLO" in s or "POR MI PUEBLO" in d or s == "PMP":
        return "POR MI PUEBLO"
    if "OPCION SAMPEDRE" in s or "OSP" in s.replace(".", "") or "OPCION SAMPEDRE" in d:
        return "OSP"
    if "IMPULSA" in s or "IMPULSA" in d:
        return "IMPULSA CIUDAD"
    if "POR MARBELLA" in s or "POR MARBELLA" in d or "SAN PEDRO" in d:
        return "IMPULSA CIUDAD"  # agrupar

    # Partido Andalucista
    if "ANDALUCISTA" in d or s == "PA":
        return "PA"

    # Verdes / Equo
    if "VERDES" in s or "EQUO" in s:
        return "VERDES"

    return s or "OTROS"


def color_for(siglas: str) -> str:
    """Devuelve el color para unas siglas canónicas."""
    return PALETTE.get(siglas, PALETTE["OTROS"])


def normalize_geojson(geojson: dict) -> dict:
    """Normaliza las siglas de cada feature y aplica colores."""
    # Construir mapa de cod → siglas canónicas
    cod_to_canonical = {}
    cod_to_denom = {}
    for f in geojson["features"]:
        for r in f["properties"]["results"]:
            if r["votos"] > 0:
                can = canonicalize(r["siglas"], r["denominacion"])
                cod = r["cod"]
                if cod not in cod_to_canonical:
                    cod_to_canonical[cod] = can
                    cod_to_denom[cod] = r["denominacion"]

    # Aplicar normalización
    for f in geojson["features"]:
        props = f["properties"]
        for r in props["results"]:
            cod = r["cod"]
            if cod in cod_to_canonical:
                r["siglas_canon"] = cod_to_canonical[cod]
                r["color"] = color_for(cod_to_canonical[cod])
            else:
                r["siglas_canon"] = "OTROS"
                r["color"] = PALETTE["OTROS"]

        # Ganador canónico
        if props["winner_cod"] in cod_to_canonical:
            wcan = cod_to_canonical[props["winner_cod"]]
            props["winner_canon"] = wcan
            props["winner_color"] = color_for(wcan)
        else:
            props["winner_canon"] = props["winner_siglas"]
            props["winner_color"] = PALETTE["OTROS"]

    geojson["palette"] = PALETTE
    geojson["normalized"] = True
    return geojson


def main():
    for year in YEARS:
        src = PROC_DIR / f"{year}.geojson"
        if not src.exists():
            print(f"⚠️  No existe {src.name}, saltando")
            continue
        with open(src, encoding="utf-8") as f:
            data = json.load(f)

        data = normalize_geojson(data)

        with open(src, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        size_kb = src.stat().st_size / 1024
        print(f"✓ {src.name} normalizado ({size_kb:.1f} KB)")

        # Copiar a web/data
        WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
        dest = WEB_DATA_DIR / f"{year}.geojson"
        with open(dest, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        print(f"  → copiado a web/data/{year}.geojson")

    print("\n✅ Normalización completa")


if __name__ == "__main__":
    main()
