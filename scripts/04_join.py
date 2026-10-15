"""
04_join.py — Une la geometría de las secciones (INE) con los resultados por mesa (infoelectoral).

Para cada año, agrega los votos de las mesas a nivel de sección censal, calcula:
- Total censo, votantes, participación
- Votos por candidatura
- Ganador y %

Salida: data/processed/{year}.geojson — un FeatureCollection listo para Leaflet.
"""

import json
from pathlib import Path
import sys

import geopandas as gpd
import pandas as pd

# Constantes Marbella
CPRO = "29"
CMUN = "069"

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PROC_DIR = PROJECT_ROOT / "data" / "processed"
INE_DIR = PROJECT_ROOT / "data" / "ine"

YEARS = ["2015", "2019", "2023"]


def aggregate_section(df_mesas: pd.DataFrame, df_votos: pd.DataFrame, df_cand: pd.DataFrame) -> pd.DataFrame:
    """Agrega las mesas a nivel de sección censal."""
    # Censo y datos agregados (una línea por mesa)
    agg_mesas = df_mesas.groupby(["cpro", "cmun", "cdis", "csec"]).agg(
        censo=("censo_ine", "sum"),
        blancos=("votos_blanco", "sum"),
        nulos=("votos_nulos", "sum"),
        candidatos=("votos_candidaturas", "sum"),
        n_mesas=("cmesa", "count"),
    ).reset_index()

    # Votos por candidatura: pivotar
    pivot = df_votos.pivot_table(
        index=["cpro", "cmun", "cdis", "csec"],
        columns="cod_candidatura",
        values="votos",
        aggfunc="sum",
        fill_value=0,
    ).reset_index()

    # Asegurar que TODAS las candidaturas del CSV están como columnas (aunque no tengan votos en alguna sección)
    for cod in df_cand["cod_candidatura"]:
        if cod not in pivot.columns:
            pivot[cod] = 0

    df = agg_mesas.merge(pivot, on=["cpro", "cmun", "cdis", "csec"], how="left")
    return df


def attach_results_to_geometry(year: str, gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Une los resultados agregados a la geometría de cada sección."""
    df_mesas = pd.read_csv(PROC_DIR / f"{year}_mesas.csv", dtype={"cdis": str, "csec": str})
    df_votos = pd.read_csv(PROC_DIR / f"{year}_votos.csv", dtype={"cdis": str, "csec": str, "cod_candidatura": str})
    df_cand = pd.read_csv(PROC_DIR / f"{year}_candidaturas.csv", dtype={"cod_candidatura": str})

    # Pad todos los códigos
    df_cand["cod_candidatura"] = df_cand["cod_candidatura"].astype(str).str.zfill(6)
    df_mesas["cdis"] = df_mesas["cdis"].str.zfill(2)
    df_mesas["csec"] = df_mesas["csec"].apply(lambda x: str(x).strip().zfill(3) if str(x).strip().isdigit() else str(x).strip())
    df_votos["cdis"] = df_votos["cdis"].str.zfill(2)
    df_votos["csec"] = df_votos["csec"].apply(lambda x: str(x).strip().zfill(3) if str(x).strip().isdigit() else str(x).strip())
    df_votos["cod_candidatura"] = df_votos["cod_candidatura"].astype(str).str.zfill(6)

    # Geometría INE: CDIS (2) + CSEC (3) → 5 chars
    gdf["CDIS"] = gdf["CDIS"].astype(str).str.zfill(2)
    gdf["CSEC"] = gdf["CSEC"].astype(str).str.zfill(3)

    # Agregar resultados por sección
    df_agg = aggregate_section(df_mesas, df_votos, df_cand)
    df_agg["CSEC_join"] = df_agg["csec"].astype(str).str.zfill(3)

    # Clave combinada para emparejar (NO usar CSEC para evitar colisión con shapefile)
    gdf["key"] = gdf["CDIS"].astype(str) + gdf["CSEC"].astype(str)
    df_agg["key"] = df_agg["cdis"].astype(str) + df_agg["CSEC_join"].astype(str)

    print(f"  Secciones en geometría: {len(gdf)}")
    print(f"  Secciones con resultados: {df_agg['key'].nunique()}")
    print(f"  Keys shapefile (sample): {gdf['key'].head().tolist()}")
    print(f"  Keys resultados (sample): {df_agg['key'].head().tolist()}")

    gdf_out = gdf.merge(df_agg, on="key", how="left")
    return gdf_out


def build_properties(row, year: str, df_cand: pd.DataFrame) -> dict:
    """Construye el diccionario de propiedades para el GeoJSON de una sección."""
    # Candidaturas
    cod_cands = df_cand["cod_candidatura"].astype(str).tolist()
    results = []
    for cod in cod_cands:
        v = row.get(cod, 0) if not pd.isna(row.get(cod, 0)) else 0
        cand_info = df_cand[df_cand["cod_candidatura"] == cod].iloc[0]
        results.append({
            "cod": cod,
            "siglas": cand_info["siglas"],
            "denominacion": cand_info["denominacion"],
            "votos": int(v),
        })

    # Ordenar por votos
    results.sort(key=lambda x: -x["votos"])

    censo = int(row.get("censo", 0)) if not pd.isna(row.get("censo", 0)) else 0
    blancos = int(row.get("blancos", 0)) if not pd.isna(row.get("blancos", 0)) else 0
    nulos = int(row.get("nulos", 0)) if not pd.isna(row.get("nulos", 0)) else 0
    candidatos = int(row.get("candidatos", 0)) if not pd.isna(row.get("candidatos", 0)) else 0
    n_mesas = int(row.get("n_mesas", 0)) if not pd.isna(row.get("n_mesas", 0)) else 0
    total_votantes = blancos + nulos + candidatos
    participacion = (100 * total_votantes / censo) if censo > 0 else 0

    # Ganador
    if results and results[0]["votos"] > 0:
        winner = results[0]
        winner_pct = 100 * winner["votos"] / candidatos if candidatos > 0 else 0
    else:
        winner = {"siglas": "N/A", "cod": ""}
        winner_pct = 0

    # Calcular % de cada candidatura
    for r in results:
        r["pct"] = round(100 * r["votos"] / candidatos, 2) if candidatos > 0 else 0

    return {
        "year": year,
        "cpro": str(row.get("CPRO", "29")),
        "cmun": str(row.get("CMUN", "069")),
        "cdis": str(row.get("CDIS", "")),
        "csec": str(row.get("CSEC", "")),
        "n_mesas": n_mesas,
        "censo": censo,
        "votantes": total_votantes,
        "blancos": blancos,
        "nulos": nulos,
        "candidatos": candidatos,
        "participacion_pct": round(participacion, 2),
        "winner_siglas": winner["siglas"],
        "winner_cod": winner["cod"],
        "winner_pct": round(winner_pct, 2),
        "results": results,
    }


def main():
    # Cargar geometría
    gdf_geo = gpd.read_file(INE_DIR / "secciones_marbella.geojson")
    print(f"Geometría cargada: {len(gdf_geo)} secciones de Marbella\n")

    for year in YEARS:
        print(f"\n📅 Año {year}")
        cand_file = PROC_DIR / f"{year}_candidaturas.csv"
        if not cand_file.exists():
            print(f"  ⚠️  No existe {cand_file.name}, saltando")
            continue
        df_cand = pd.read_csv(cand_file, dtype={"cod_candidatura": str})
        df_cand["cod_candidatura"] = df_cand["cod_candidatura"].astype(str).str.zfill(6)

        gdf_year = attach_results_to_geometry(year, gdf_geo.copy())

        # Construir GeoJSON
        features = []
        for idx, row in gdf_year.iterrows():
            props = build_properties(row, year, df_cand)
            geom = row["geometry"]
            if geom is None or (hasattr(geom, "is_empty") and geom.is_empty):
                continue
            features.append({
                "type": "Feature",
                "geometry": json.loads(gpd.GeoSeries([geom]).to_json())["features"][0]["geometry"],
                "properties": props,
            })

        geojson = {
            "type": "FeatureCollection",
            "year": year,
            "metadata": {
                "municipio": "Marbella",
                "cpro": CPRO,
                "cmun": CMUN,
                "year": year,
                "n_secciones": len(features),
                "fuente_resultados": "Ministerio del Interior - infoelectoral.interior.gob.es",
                "fuente_geometria": "INE - Seccionado censal 2023",
            },
            "features": features,
        }

        out_path = PROC_DIR / f"{year}.geojson"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(geojson, f, ensure_ascii=False, separators=(",", ":"))
        size_kb = out_path.stat().st_size / 1024
        print(f"  ✓ {out_path.name} ({len(features)} features, {size_kb:.1f} KB)")

    print(f"\n✅ GeoJSONs en: {PROC_DIR}")


if __name__ == "__main__":
    main()
