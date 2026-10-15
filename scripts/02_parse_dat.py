"""
02_parse_dat.py â€” Parsea los .dat de infoelectoral y extrae datos de Marbella.

Ficheros procesados (formato fixed-width):
  - 03xxaamm.DAT: candidaturas (cod, siglas, denominaciÃ³n)
  - 09xxaamm.DAT: datos comunes de mesa (censo, votos blanco/nulo/candidaturas)
  - 10xxaamm.DAT: votos por candidatura en cada mesa

Filtro: CPRO=29 (MÃ¡laga), CMUN=069 (Marbella).
Salida: data/processed/{year}_mesas.csv y {year}_candidaturas.csv
"""

import csv
import zipfile
from pathlib import Path
import sys

import pandas as pd

# Constantes
CPRO = "29"   # MÃ¡laga
CMUN = "069"  # Marbella

# Estructuras de campos por tipo de registro (posiciones 0-based, [inicio:fin])
FIELDS_03 = {
    # 03xxaamm.DAT: candidaturas
    "tipo":            (0, 2),    # "04" municipales
    "anio":            (2, 6),
    "mes":             (6, 8),
    "cod_candidatura": (8, 14),
    "siglas":          (14, 64),
    "denominacion":    (64, 214),
    "cod_prov":        (214, 220),
    "cod_aut":         (220, 226),
    "cod_nac":         (226, 232),
}

FIELDS_09 = {
    # 09xxaamm.DAT: datos comunes de mesa
    "tipo":                (0, 2),
    "anio":                (2, 6),
    "mes":                 (6, 8),
    "vuelta":              (8, 9),
    "cpro":                (11, 13),
    "cmun":                (13, 16),
    "cdis":                (16, 18),
    "csec":                (18, 22),
    "cmesa":               (22, 23),
    "censo_ine":           (23, 30),
    "censo_escrutinio":    (30, 37),
    "censo_cere":          (37, 44),
    "votantes_cere":       (44, 51),
    "vot_avance1":         (51, 58),
    "vot_avance2":         (58, 65),
    "votos_blanco":        (65, 72),
    "votos_nulos":         (72, 79),
    "votos_candidaturas":  (79, 86),
    "votos_afirmativos":   (86, 93),
    "votos_negativos":     (93, 100),
    "datos_oficiales":     (100, 101),
}

FIELDS_10 = {
    # 10xxaamm.DAT: votos por candidatura en mesa
    "tipo":            (0, 2),
    "anio":            (2, 6),
    "mes":             (6, 8),
    "vuelta":          (8, 9),
    "cpro":            (11, 13),
    "cmun":            (13, 16),
    "cdis":            (16, 18),
    "csec":            (18, 22),
    "cmesa":           (22, 23),
    "cod_candidatura": (23, 29),
    "votos":           (29, 36),
}


def parse_line(line: str, fields: dict) -> dict:
    """Parsea una lÃ­nea segÃºn el diccionario de campos (slices 0-based)."""
    out = {}
    for key, (start, end) in fields.items():
        chunk = line[start:end] if end <= len(line) else ""
        out[key] = chunk.strip() if key in ("cmesa", "datos_oficiales", "siglas", "denominacion", "csec") else chunk.strip()
    return out


def read_line(raw: bytes) -> str:
    """Decodifica una lÃ­nea de un .dat (cp1252 segÃºn la documentaciÃ³n)."""
    return raw.decode("cp1252", errors="replace").rstrip("\r\n")


def process_zip(zip_path: Path, year: str, out_dir: Path) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """
    Procesa un ZIP de infoelectoral y devuelve (candidaturas, mesas, votos_por_cand).
    Filtra por Marbella (cpro=29, cmun=069).
    """
    candidaturas = []
    mesas = []
    votos = []

    with zipfile.ZipFile(zip_path) as zf:
        # Detectar los ficheros por prefijo (03, 09, 10)
        members = zf.namelist()
        file_03 = next((m for m in members if _matches(m, "03")), None)
        file_09 = next((m for m in members if _matches(m, "09")), None)
        file_10 = next((m for m in members if _matches(m, "10")), None)

        # fichero 03: candidaturas
        if file_03:
            with zf.open(file_03) as f:
                for raw in f:
                    line = read_line(raw)
                    if len(line) < 14:
                        continue
                    rec = parse_line(line, FIELDS_03)
                    if rec["tipo"] == "04":
                        candidaturas.append({
                            "cod_candidatura": rec["cod_candidatura"].lstrip("0") or "0",
                            "siglas": rec["siglas"].strip(),
                            "denominacion": rec["denominacion"].strip(),
                        })

        # fichero 09: datos comunes de mesa
        if file_09:
            with zf.open(file_09) as f:
                for raw in f:
                    line = read_line(raw)
                    if len(line) < 100:
                        continue
                    rec = parse_line(line, FIELDS_09)
                    if rec["tipo"] != "04":
                        continue
                    if rec["cpro"] != CPRO or rec["cmun"] != CMUN:
                        continue
                    mesas.append({
                        "cpro": rec["cpro"],
                        "cmun": rec["cmun"],
                        "cdis": rec["cdis"],
                        "csec": rec["csec"],
                        "cmesa": rec["cmesa"],
                        "censo_ine": int(rec["censo_ine"] or 0),
                        "votos_blanco": int(rec["votos_blanco"] or 0),
                        "votos_nulos": int(rec["votos_nulos"] or 0),
                        "votos_candidaturas": int(rec["votos_candidaturas"] or 0),
                        "datos_oficiales": rec["datos_oficiales"] == "S",
                    })

        # fichero 10: votos por candidatura en mesa
        if file_10:
            with zf.open(file_10) as f:
                for raw in f:
                    line = read_line(raw)
                    if len(line) < 36:
                        continue
                    rec = parse_line(line, FIELDS_10)
                    if rec["tipo"] != "04":
                        continue
                    if rec["cpro"] != CPRO or rec["cmun"] != CMUN:
                        continue
                    votos.append({
                        "cpro": rec["cpro"],
                        "cmun": rec["cmun"],
                        "cdis": rec["cdis"],
                        "csec": rec["csec"],
                        "cmesa": rec["cmesa"],
                        "cod_candidatura": rec["cod_candidatura"].lstrip("0") or "0",
                        "votos": int(rec["votos"] or 0),
                    })

    df_cand = pd.DataFrame(candidaturas).drop_duplicates("cod_candidatura")
    df_mesas = pd.DataFrame(mesas)
    df_votos = pd.DataFrame(votos)
    return df_cand, df_mesas, df_votos


def _matches(name: str, prefix: str) -> bool:
    """Â¿El nombre del fichero empieza por prefix + xx2305? (case-insensitive)."""
    upper = name.upper()
    return upper.endswith(".DAT") and upper[:2] == prefix and len(upper) >= 12


def main():
    raw_dir = Path(__file__).resolve().parent.parent / "data" / "raw"
    out_dir = Path(__file__).resolve().parent.parent / "data" / "processed"
    out_dir.mkdir(parents=True, exist_ok=True)

    zips = sorted(raw_dir.glob("04*_MESA.zip"))
    if not zips:
        print(f"âŒ No hay ZIPs en {raw_dir}. Ejecuta primero 01_download.py")
        sys.exit(1)

    for zip_path in zips:
        # year = "2015" from "04201505_MESA.zip"
        year = zip_path.stem[2:6]  # 04201505 -> "2015"
        print(f"\nðŸ“„ Procesando {zip_path.name} (aÃ±o {year})")

        df_cand, df_mesas, df_votos = process_zip(zip_path, year, out_dir)

        # Filtrar candidaturas: solo las que aparecen en Marbella
        if not df_votos.empty:
            codes_in_marbella = set(df_votos["cod_candidatura"].unique())
            df_cand = df_cand[df_cand["cod_candidatura"].isin(codes_in_marbella)].reset_index(drop=True)

        # Guardar
        df_cand.to_csv(out_dir / f"{year}_candidaturas.csv", index=False, encoding="utf-8", quoting=csv.QUOTE_MINIMAL)
        df_mesas.to_csv(out_dir / f"{year}_mesas.csv", index=False, encoding="utf-8", quoting=csv.QUOTE_MINIMAL)
        df_votos.to_csv(out_dir / f"{year}_votos.csv", index=False, encoding="utf-8", quoting=csv.QUOTE_MINIMAL)

        print(f"  âœ“ Candidaturas: {len(df_cand)}")
        print(f"  âœ“ Mesas:        {len(df_mesas)}")
        print(f"  âœ“ Votos (lÃ­neas): {len(df_votos)}")

    print(f"\nâœ… CSVs en: {out_dir}")


if __name__ == "__main__":
    main()

