"""
03_load_ine.py — Descarga el shapefile del seccionado censal del INE y filtra Marbella.

URL: https://www.ine.es/prodyser/cartografia/seccionado_{YEAR}.zip
Filtra: CPRO=29 (Málaga), CMUN=069 (Marbella)
Salida: data/ine/secciones_marbella.geojson (un fichero con todas las secciones)
"""

import zipfile
from pathlib import Path

import geopandas as gpd
import requests
from shapely.geometry import shape

CPRO = "29"
CMUN = "069"

INE_DIR = Path(__file__).resolve().parent.parent / "data" / "ine"


def download_shapefile(year: int = 2023) -> Path:
    """Descarga el shapefile del INE para un año concreto."""
    url = f"https://www.ine.es/prodyser/cartografia/seccionado_{year}.zip"
    dest = INE_DIR / f"seccionado_{year}.zip"
    if dest.exists() and dest.stat().st_size > 1_000_000:
        print(f"  ⏭️  Ya existe: {dest.name}")
        return dest

    print(f"  ⬇️  Descargando {url}...")
    with requests.get(url, stream=True, timeout=300) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_content(chunk_size=262144):
                f.write(chunk)
    size_mb = dest.stat().st_size / 1024 / 1024
    print(f"  ✓ {dest.name} ({size_mb:.1f} MB)")
    return dest


def extract_zip(zip_path: Path) -> Path:
    """Extrae el ZIP en una subcarpeta con su nombre."""
    target_dir = INE_DIR / zip_path.stem
    if target_dir.exists() and any(target_dir.glob("*.shp")):
        print(f"  ⏭️  Ya extraído: {target_dir.name}")
        return target_dir
    target_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(target_dir)
    print(f"  ✓ Extraído en: {target_dir.name}")
    return target_dir


def filter_marbella(shp_dir: Path) -> Path:
    """Carga el shapefile, filtra Marbella y guarda GeoJSON."""
    out_geojson = INE_DIR / "secciones_marbella.geojson"
    if out_geojson.exists():
        print(f"  ⏭️  Ya existe: {out_geojson.name}")
        return out_geojson

    shp_files = list(shp_dir.glob("*.shp"))
    if not shp_files:
        shp_files = list(shp_dir.rglob("*.shp"))
    if not shp_files:
        raise FileNotFoundError(f"No hay .shp en {shp_dir}")
    shp_path = shp_files[0]
    print(f"  📂 Leyendo {shp_path.name}...")

    gdf = gpd.read_file(shp_path)
    print(f"  ✓ {len(gdf)} secciones leídas de toda España")

    # Detectar nombres de columnas (varían por año)
    cols = list(gdf.columns)
    print(f"  Columnas: {cols[:10]}...")

    # Las columnas INE se llaman CPRO, CMUN, CPROV, MUN, DISTR, SECC, etc.
    cpro_col = next((c for c in cols if c.upper() in ("CPRO", "CPROV")), None)
    cmun_col = next((c for c in cols if c.upper() in ("CMUN", "MUN", "CMUNC")), None)
    if not cpro_col or not cmun_col:
        raise RuntimeError(f"No se encontraron columnas CPRO/CMUN. Hay: {cols}")

    print(f"  Filtrando: {cpro_col}={CPRO} AND {cmun_col}={CMUN}")
    gdf[cpro_col] = gdf[cpro_col].astype(str).str.zfill(2)
    gdf[cmun_col] = gdf[cmun_col].astype(str).str.zfill(3)
    mask = (gdf[cpro_col] == CPRO) & (gdf[cmun_col] == CMUN)
    gdf_marbella = gdf[mask].copy()
    print(f"  ✓ {len(gdf_marbella)} secciones de Marbella")

    # Renombrar columnas a nombres canónicos
    rename = {
        cpro_col: "CPRO",
        cmun_col: "CMUN",
    }
    if "CDIS" in [c.upper() for c in cols] or "DIST" in [c.upper() for c in cols]:
        cdis_col = next((c for c in cols if c.upper() in ("CDIS", "DIST", "DISTR")), None)
        if cdis_col:
            rename[cdis_col] = "CDIS"
    if "CSEC" in [c.upper() for c in cols] or "SECC" in [c.upper() for c in cols] or "SEC" in [c.upper() for c in cols]:
        csec_col = next((c for c in cols if c.upper() in ("CSEC", "SECC", "SEC")), None)
        if csec_col:
            rename[csec_col] = "CSEC"

    gdf_marbella = gdf_marbella.rename(columns=rename)

    # Asegurar CRS WGS84 para web
    if gdf_marbella.crs and gdf_marbella.crs.to_epsg() != 4326:
        gdf_marbella = gdf_marbella.to_crs(epsg=4326)
        print(f"  ✓ Reproyectado a WGS84 (EPSG:4326)")

    # Guardar GeoJSON
    gdf_marbella.to_file(out_geojson, driver="GeoJSON")
    print(f"  ✓ Guardado: {out_geojson} ({out_geojson.stat().st_size / 1024:.1f} KB)")
    return out_geojson


def main():
    INE_DIR.mkdir(parents=True, exist_ok=True)
    print("📥 Descargando shapefile del seccionado censal (INE 2023)...")
    zip_path = download_shapefile(2023)
    print("\n📦 Extrayendo...")
    shp_dir = extract_zip(zip_path)
    print("\n🗺️  Filtrando Marbella...")
    filter_marbella(shp_dir)
    print("\n✅ Shapefile de Marbella listo")


if __name__ == "__main__":
    main()
