# Documentación del formato `.dat` de infoelectoral

## Estructura general

Los ficheros de resultados electorales del Ministerio del Interior son texto plano en formato **fixed-width** (anchos fijos por campo). Cada línea es un registro.

Hay dos grandes familias de ficheros según el tipo de elección:

- **Municipios ≤ 250 hab** (un solo fichero, una sola mesa): `xxxxx.DAT`
- **Municipios > 250 hab** (varios ficheros por tipo de registro):
  - `01.DAT` — Cabeceras de tipo de elección
  - `02.DAT` — Cabeceras de CCAA / provincia
  - `03.DAT` — Cabeceras de municipio
  - `04.DAT` — Candidaturas
  - `05.DAT` — Votación por mesa (resultados)
  - `06.DAT` — Votación por candidatura

(Los números pueden variar ligeramente por convocatoria; el script `01_download.py` los detecta por nombre.)

## Tipos de registro en `05.DAT` (Municipales > 250 hab)

Cada línea tiene un **tipo de registro** identificado por el primer carácter (o los dos primeros):

| Código | Descripción                         |
|--------|-------------------------------------|
| 01     | Cabecera tipo de elección           |
| 02     | Cabecera CCAA / provincia           |
| 03     | Cabecera municipio                  |
| 04     | Candidato                           |
| 05     | Resultado de votación por candidatura (mesa) |
| 06     | Cierre de municipio                 |

## Campos clave (registros tipo 05)

| Posición | Campo                | Tipo   | Ejemplo |
|----------|----------------------|--------|---------|
| 1-2      | Tipo de registro     | 2N     | "05"    |
| 3-4      | Tipo de elección     | 2N     | "01"    |
| 5-9      | Fecha                | 5N     | 280523  |
| 10-12    | ...                  |        |         |
| ...      | Código provincia (CPRO) | 2N  | "29"    |
| ...      | Código municipio (CMUN) | 3N  | "069"   |
| ...      | Código distrito (CDIS)  | 2N  | "01"    |
| ...      | Código sección (CSEC)   | 3N  | "003"   |
| ...      | Código mesa (CMESA)     | 2N  | "A"     |
| ...      | Votos candidatura       | 6N  | 000434  |
| ...      | Votos blancos           | 6N  | 000018  |
| ...      | Votos nulos             | 6N  | 000007  |

> ⚠️ **Las posiciones exactas varían entre convocatorias.** Antes de hacer el parser definitivo, se debe inspeccionar un fichero real y mapear campos manualmente.

## Codificaciones importantes

- `CPRO=29`, `CMUN=069` → Marbella (Málaga).
- `CSEC=000` (todos ceros) → la sección es el total del municipio (no se procesa; se reconstruye agregando las mesas).
- Las candidaturas se identifican por un **código de candidatura** (referencia a `04.DAT`).

## Referencias

- [Documentación oficial del formato](https://infoelectoral.interior.gob.es/estaticos/documentos/open-data/estructura_datos.pdf) (si está disponible).
- Paquete R [`infoelectoral`](https://infoelectoral.spainelectoralproject.com/) — implementa la lectura completa.
