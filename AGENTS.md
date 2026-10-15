# AGENTS.md — Instrucciones para agentes AI

> Visualizador de resultados electorales municipales de Marbella (2015/2019/2023). Pipeline Python + frontend
> estático Leaflet. Datos del Ministerio del Interior + INE.

## 🚀 Comandos clave

```bash
# Pipeline completo (orden estricto)
python run_all.py

# Paso a paso
python scripts/01_download.py        # descarga ZIPs infoelectoral
python scripts/02_parse_dat.py        # parsea .dat fixed-width, filtra Marbella
python scripts/03_load_ine.py         # carga shapefile de secciones censales
python scripts/04_join.py             # une geometría INE + resultados por sección
python scripts/05_normalize.py        # normaliza siglas, asigna colores, copia a web/

# Servir la web
cd web && python -m http.server 8000
```

No hay tests automatizados. La validación es ejecutar el pipeline de extremo a extremo y abrir la web.

## 🗂️ Estructura

```
data/raw/{year}/            ZIPs descargados de infoelectoral (input)
data/ine/                   Shapefile INE (input, no regenerar)
data/processed/{year}*.csv  Tablas intermedias del pipeline
data/processed/{year}.geojson  GeoJSON final (generado por 04_join)
web/data/{year}.geojson     Copia para el frontend (generada por 05_normalize)
scripts/01-05_*.py          Pipeline en orden; cada script lee de processed y escribe el siguiente
```

## ⚠️ Reglas del proyecto

- **Encoding**: `.dat` se leen en **cp1252** (ver `read_line` en `02_parse_dat.py`); los CSVs/GeoJSON se
  escriben en **UTF-8**. No cambies esto.
- **Fixed-width**: el ancho de cada campo en los `.dat` está definido como tuplas `(inicio, fin)` en
  `02_parse_dat.py` (FIELDS_03, FIELDS_09, FIELDS_10). Las posiciones oficiales pueden variar entre
  convocatorias — si un parse falla en un año nuevo, revisa las posiciones reales del `.dat` antes de tocar
  las constantes.
- **Filtro Marbella**: `CPRO="29"` (Málaga) + `CMUN="069"`. Está hardcodeado en `02_parse_dat.py`. Cualquier
  ampliación a otro municipio requiere parametrizar.
- **Clave de join sección**: `CDIS` (2 dígitos, distrito) + `CSEC` (3 dígitos, sección). Coincide entre
  shapefile INE y `.dat`. En el GeoJSON final se concatena como `${cdis}-${csec}`.
- **`CSEC="000"`** = total del municipio (no es una sección real). Se excluye en el join; los totales se
  reconstruyen agregando mesas en el parser.
- **Partido "OTROS"**: cualquier candidatura que no case con `canonicalize()` en `05_normalize.py` cae aquí
  con color gris `#6b7280`. Si añades un partido nuevo, extiende `canonicalize()` Y la `PALETTE` en el mismo
  script.
- **Paleta de colores**: está centralizada en `05_normalize.py` (`PALETTE`). El frontend lee los colores del
  GeoJSON (`geojson.palette` + `feature.properties.winner_color`), no de una constante propia. Para añadir un
  color nuevo, edita solo ese script.
- **GeoJSON final**: el esquema está documentado en el README raíz. Cada feature incluye `results[]` con
  `cod`, `siglas`, `denominacion`, `votos`, `pct`, `siglas_canon`, `color`. No eliminar campos: el panel
  lateral del frontend los consume.
- **Modos de UI (mutuamente exclusivos)**: estándar (ganador → coropleta por `winner_color`), comparativa
  (panel multi-año con `partyGroupKey`) y oportunidad (panel de ranking + coropleta de rampa por
  `dificultad = gap_votos / (censo − votantes)`). Los tres se calculan en frontend sobre
  `web/data/{year}.geojson`; el pipeline Python no aporta datos extra para el modo oportunidad.

## 🧭 Convenciones de código

- Scripts numerados `01_…05_` se ejecutan en orden. El sufijo numérico es parte del contrato — no renombrar.
- Cada script es ejecutable directamente (`if __name__ == "__main__"`) y `run_all.py` los invoca en orden.
- Mensajes de progreso en stdout con emojis (`✓`, `⚠️`, `❌`) — mantener el estilo para logs consistentes.
- Paths siempre con `Path(__file__).resolve().parent.parent / "data" / ...` (relativo al script, no al cwd).
- Sin framework frontend: HTML/CSS/JS plano. Leaflet vía CDN con SRI hash en `index.html` — no cambiar a npm
  sin discutirlo.
- JS en modo estricto (`"use strict"`) y IIFE; sin módulos ES ni bundler.

## 🚫 Lo que NO hacer

- No borrar ni sobrescribir `data/ine/` ni `data/raw/` (son inputs).
- No hardcodear años fuera de las constantes `YEARS` / `YEARS_DICT` — son la fuente de verdad.
- No introducir dependencias nuevas en `requirements.txt` sin justificación (pandas, geopandas, shapely,
  pyproj, requests, tqdm es todo lo que se necesita).
- No commitear credenciales; las del Ministerio (`apiInfoelectoral:apiInfoelectoralPro`) son públicas y van en
  `01_download.py`, no en `.env`.

## 📚 Contexto adicional

- Formato de los `.dat`: [docs/format_doc.txt](docs/format_doc.txt) (anotaciones propias + doc oficial del
  Ministerio).
- Estructura del GeoJSON, paleta y API: [README.md](README.md).
- Roadmap: estados S0–S5 completados, S6 (modo comparativa) y S7 (geocodificación) pendientes — ver
  `README.md`.

## ✅ Checklist al terminar cambios

1. `python run_all.py` ejecuta sin errores y regenera los GeoJSON.
2. `cd web && python -m http.server 8000` carga `2015/2019/2023` sin 404 en consola.
3. Click en una sección abre el panel con candidaturas, votos y %.
4. Si tocaste partidos/siglas/colores, la leyenda se actualiza automáticamente (se renderiza desde
   `geojson.palette`).
