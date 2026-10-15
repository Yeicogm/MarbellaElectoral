/* MarbellaElectoral — lógica de Leaflet */
(function () {
  "use strict";

  const YEARS = ["2015", "2019", "2023"];
  const DATA_PATH = "data";
  const MARBELLA_CENTER = [36.516, -4.883];
  const MARBELLA_ZOOM = 12;

  const state = {
    year: "2019",
    geojson: null,
    layer: null,
    map: null,
    featureById: new Map(),
    // Cache de los 3 GeoJSON cargados en paralelo al boot
    byYear: {},
    compare: false,
    // Modo oportunidad: ranking de secciones donde el esfuerzo es más
    // efectivo para adelantar al siguiente partido, según el partido
    // elegido. Recalculado en `computeOpportunity` al activarlo.
    opportunity: false,
    opportunityParty: null, // siglas_canon del partido seleccionado
    opportunitySort: "dificultad", // "dificultad" | "gap" — defecto: más fácil arriba
    opportunityShowAll: false, // top-15 vs todas
    opportunityRows: null, // filas de avance calculadas (o null si no activo)
    opportunityDefense: null, // filas de "a defender" (partido ya es 1º)
  };

  /* ---------- Inicialización del mapa ---------- */
  function initMap() {
    state.map = L.map("map", {
      center: MARBELLA_CENTER,
      zoom: MARBELLA_ZOOM,
      zoomControl: true,
      preferCanvas: true,
    });
    // Tiles de OpenStreetMap
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(state.map);
  }

  /* ---------- Carga y render de datos ---------- */
  async function loadYear(year) {
    const url = `${DATA_PATH}/${year}.geojson`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`No se pudo cargar ${url}`);
    return r.json();
  }

  async function preloadAllYears() {
    const results = await Promise.all(YEARS.map(loadYear));
    for (let i = 0; i < YEARS.length; i++) {
      state.byYear[YEARS[i]] = results[i];
    }
  }

  function styleFeature(feature) {
    const props = feature.properties || {};
    const fill = props.winner_color || "#9ca3af";
    return {
      fillColor: fill,
      weight: 1,
      color: "#475569",
      fillOpacity: 0.78,
    };
  }

  function highlightStyle() {
    return {
      weight: 2.5,
      color: "#0f172a",
      fillOpacity: 0.88,
    };
  }

  /* ---------- Modo oportunidad: estilo del mapa ----------
   * El color base es el del partido elegido (intensidad = "facilidad").
   * - Partidos sin candidatura en la sección → gris muy tenue
   * - Secciones ganadas por el partido → tinte neutro (ya es tuyo)
   * - Resto: rampa de opacidad + saturación proporcional a la dificultad
   */
  function hexToRgb(hex) {
    const h = String(hex || "#6b7280").replace("#", "");
    const full =
      h.length === 3
        ? h
            .split("")
            .map((c) => c + c)
            .join("")
        : h;
    const n = parseInt(full, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function withAlpha(hex, a) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  // Devuelve un color de relleno para la sección, según el ranking de
  // oportunidad precalculado en `state.opportunityRows`.
  function opportunityStyleFor(feature) {
    const props = feature.properties || {};
    const id = `${props.cdis}-${props.csec}`;
    const row = (state.opportunityRowsById || new Map()).get(id);
    const baseHex =
      (state.geojson && state.geojson.palette && state.geojson.palette[state.opportunityParty]) || "#1d4ed8";
    let fill;
    let opacity;
    if (!row) {
      // Partido no se presenta o fila no incluida (e.g. sólo ganador en "a defender")
      const isWinner = props.winner_canon === state.opportunityParty;
      if (isWinner) {
        // Ya ganada: tinte neutro del partido con baja opacidad
        fill = baseHex;
        opacity = 0.22;
      } else {
        // Sin candidatura: gris muy tenue
        fill = "#9ca3af";
        opacity = 0.12;
      }
    } else if (row.pos === 1) {
      // Posible inconsistencia (P figura como 1º pero la fila está en ranking,
      // p.ej. empate): tinte neutro
      fill = baseHex;
      opacity = 0.22;
    } else {
      // Rampa: menor dificultad → más opaco y saturado
      // 0.0–0.2 muy fácil, 0.2–0.4 fácil, 0.4–0.7 medio, >0.7 difícil
      const d = row.dificultad;
      let a;
      if (d == null) a = 0.3;
      else if (d <= 0.2) a = 0.85;
      else if (d <= 0.4) a = 0.7;
      else if (d <= 0.7) a = 0.55;
      else a = 0.4;
      fill = baseHex;
      opacity = a;
    }
    return {
      fillColor: fill,
      fillOpacity: opacity,
      weight: 1,
      color: "#475569",
    };
  }
  function styleFeature(feature) {
    if (state.opportunity) return opportunityStyleFor(feature);
    const props = feature.properties || {};
    const fill = props.winner_color || "#9ca3af";
    return {
      fillColor: fill,
      weight: 1,
      color: "#475569",
      fillOpacity: 0.78,
    };
  }

  // Centra y abre la sección en el panel estándar (usado desde el ranking)
  function focusOnSection(sectionId) {
    const f = state.featureById.get(sectionId);
    if (!f) return;
    const lyr =
      state.layer && state.layer.getLayers
        ? state.layer.getLayers().find((l) => {
            const p = l.feature && l.feature.properties;
            return p && `${p.cdis}-${p.csec}` === sectionId;
          })
        : null;
    if (lyr && lyr.getBounds && lyr.getBounds().isValid()) {
      state.map.fitBounds(lyr.getBounds(), { padding: [40, 40], maxZoom: 16 });
    }
    state.lastClickedId = sectionId;
    if (state.compare) showComparePanel(sectionId);
    else showPanel(f);
  }

  function renderYear(data) {
    state.geojson = data;

    if (state.layer) {
      state.map.removeLayer(state.layer);
      state.featureById.clear();
    }

    state.layer = L.geoJSON(data, {
      style: styleFeature,
      onEachFeature: (feature, lyr) => {
        const props = feature.properties || {};
        const id = `${props.cdis}-${props.csec}`;
        state.featureById.set(id, feature);

        // Popup ligero al hover — pasa una función para que el contenido
        // se evalúe cada vez que se muestra (refleja el modo y el partido
        // activo). En modo oportunidad se reescribe también vía
        // `setTooltipContent` en `repaintOpportunity`.
        const tipHtml = () => {
          if (state.opportunity) {
            const row = (state.opportunityRowsById || new Map()).get(id);
            const party = state.opportunityParty || "—";
            if (!row) {
              const isWinner = props.winner_canon === state.opportunityParty;
              return `<strong>${party}</strong> ${isWinner ? "ya ganada" : "sin candidatura"}<br><small>Sección ${props.cdis}-${props.csec || "?"}</small>`;
            }
            if (row.pos === 1) {
              return `<strong>${party}</strong> ya 1º (+${row.margin_next} vs 2º)<br><small>Sección ${props.cdis}-${props.csec || "?"}</small>`;
            }
            const dStr = row.dificultad == null ? "—" : (row.dificultad * 100).toFixed(1) + "%";
            return `<strong>${party}</strong>: +${row.gap_pp.toFixed(1)} pp para adelantar<br><small>Sección ${props.cdis}-${props.csec || "?"} · dificultad ${dStr}</small>`;
          }
          const winner = props.winner_canon || "—";
          const pct = props.winner_pct || 0;
          return `<strong>${winner}</strong> ${pct.toFixed(1)}%<br><small>Sección ${props.cdis}-${props.csec || "?"}</small>`;
        };
        lyr.bindTooltip(tipHtml, { sticky: true, opacity: 0.95 });

        lyr.on("mouseover", () => lyr.setStyle(highlightStyle()));
        lyr.on("mouseout", () => lyr.setStyle(styleFeature(feature)));
        lyr.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          state.lastClickedId = id;
          if (state.compare) {
            showComparePanel(id);
          } else {
            showPanel(feature);
          }
        });
      },
    }).addTo(state.map);

    // Ajustar a los bounds de las features
    if (state.layer.getBounds && state.layer.getBounds().isValid()) {
      state.map.fitBounds(state.layer.getBounds(), { padding: [20, 20] });
    }

    renderLegend(data);
  }

  // Re-pinta la capa existente (estilo + tooltips) sin recrear el GeoJSON.
  // Se usa al cambiar modo oportunidad, partido seleccionado o criterio de
  // orden, para que el mapa refleje la nueva configuración sin recargar.
  function repaintOpportunity() {
    if (!state.layer) return;
    state.layer.eachLayer((lyr) => {
      lyr.setStyle(styleFeature(lyr.feature));
      const id = (() => {
        const p = lyr.feature && lyr.feature.properties;
        return p ? `${p.cdis}-${p.csec}` : null;
      })();
      if (!id) return;
      // Reemplaza el contenido del tooltip
      const party = state.opportunityParty || "—";
      const props = lyr.feature.properties || {};
      let html;
      const row = (state.opportunityRowsById || new Map()).get(id);
      if (!row) {
        const isWinner = props.winner_canon === state.opportunityParty;
        html = `<strong>${party}</strong> ${isWinner ? "ya ganada" : "sin candidatura"}<br><small>Sección ${props.cdis}-${props.csec || "?"}</small>`;
      } else if (row.pos === 1) {
        html = `<strong>${party}</strong> ya 1º (+${row.margin} vs 2º)<br><small>Sección ${props.cdis}-${props.csec || "?"}</small>`;
      } else {
        const dStr = row.dificultad == null ? "—" : (row.dificultad * 100).toFixed(1) + "%";
        html = `<strong>${party}</strong>: +${row.gap_pp.toFixed(1)} pp para adelantar<br><small>Sección ${props.cdis}-${props.csec || "?"} · dificultad ${dStr}</small>`;
      }
      lyr.setTooltipContent(html);
    });
  }

  /* ---------- Leyenda ---------- */
  function renderLegend(data) {
    if (state.opportunity) {
      renderOpportunityLegend(data);
      return;
    }
    const palette = data.palette || {};
    const usados = new Set();
    for (const f of data.features) {
      const can = f.properties.winner_canon;
      if (can) usados.add(can);
    }
    const items = [];
    for (const sigla of usados) {
      const color = palette[sigla] || "#6b7280";
      items.push(
        `<span class="legend-item"><span class="legend-swatch" style="background:${color}"></span>${sigla}</span>`,
      );
    }
    document.getElementById("legend").innerHTML = items.join("");
  }

  // Leyenda de rampa de oportunidad para el partido seleccionado.
  function renderOpportunityLegend(data) {
    const baseHex = (data.palette && data.palette[state.opportunityParty]) || "#1d4ed8";
    const swatch = (label, color) =>
      `<span class="legend-item"><span class="legend-swatch" style="background:${color}"></span>${label}</span>`;
    const html = [
      swatch("muy fácil (≤20%)", withAlpha(baseHex, 0.85)),
      swatch("fácil (≤40%)", withAlpha(baseHex, 0.7)),
      swatch("medio (≤70%)", withAlpha(baseHex, 0.55)),
      swatch("difícil (>70%)", withAlpha(baseHex, 0.4)),
      swatch("ya ganada", withAlpha(baseHex, 0.22)),
      swatch("sin candidatura", withAlpha("#9ca3af", 0.12)),
    ].join("");
    document.getElementById("legend").innerHTML = html;
  }

  /* ---------- Panel lateral con detalle ---------- */
  function showPanel(feature) {
    const props = feature.properties || {};
    const color = props.winner_color || "#9ca3af";
    const winner = props.winner_canon || "—";
    const results = (props.results || []).filter((r) => r.votos > 0);

    // Si estamos en modo oportunidad, añadimos un botón "Volver al ranking"
    // arriba del panel para que el usuario pueda regresar al ranking sin
    // tener que desactivar y reactivar el toggle.
    const backButton = state.opportunity
      ? `<div class="panel-section back-button-wrap">
           <button class="back-to-ranking" id="backToRanking" type="button">
             <span class="back-icon">←</span> Volver al ranking de oportunidad
           </button>
         </div>`
      : "";

    const html = `
      ${backButton}
      <div class="panel-section">
        <p class="section-title">Sección censal</p>
        <div class="section-id">
          <span class="pill">D${props.cdis || "?"}</span>
          <h2>Sección ${props.csec || "?"}</h2>
        </div>
      </div>

      <div class="panel-section">
        <div class="winner-block" style="border-left-color:${color}">
          <p class="winner-label">Ganador</p>
          <p class="winner-name" style="color:${color}">${winner}</p>
          <p class="winner-pct">${(props.winner_pct || 0).toFixed(2)}% de los votos a candidaturas</p>
        </div>
      </div>

      <div class="panel-section">
        <div class="stats-row">
          <div class="stat">
            <p class="stat-label">Censo</p>
            <p class="stat-value">${fmt(props.censo)}</p>
          </div>
          <div class="stat">
            <p class="stat-label">Votantes</p>
            <p class="stat-value">${fmt(props.votantes)}</p>
          </div>
          <div class="stat">
            <p class="stat-label">Participación</p>
            <p class="stat-value">${(props.participacion_pct || 0).toFixed(1)}%</p>
          </div>
          <div class="stat">
            <p class="stat-label">Mesas</p>
            <p class="stat-value">${props.n_mesas || 0}</p>
          </div>
        </div>
      </div>

      <div class="panel-section">
        <p class="section-title">Resultados</p>
        <table class="results-table">
          <thead>
            <tr>
              <th>Candidatura</th>
              <th class="num">Votos</th>
              <th class="num">%</th>
            </tr>
          </thead>
          <tbody>
            ${results
              .map(
                (r) => `
              <tr class="${r.siglas_canon === winner ? "winner-row" : ""}">
                <td><span class="dot" style="background:${r.color}"></span>${escapeHtml(r.siglas_canon)}</td>
                <td class="num">${fmt(r.votos)}</td>
                <td class="pct">${(r.pct || 0).toFixed(2)}%</td>
              </tr>
            `,
              )
              .join("")}
            <tr>
              <td><span class="dot" style="background:#94a3b8"></span>Blanco</td>
              <td class="num">${fmt(props.blancos)}</td>
              <td class="pct">—</td>
            </tr>
            <tr>
              <td><span class="dot" style="background:#94a3b8"></span>Nulo</td>
              <td class="num">${fmt(props.nulos)}</td>
              <td class="pct">—</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="panel-section">
        <p class="section-title">Año</p>
        <p style="font-size:14px;color:var(--text-muted)">Convocatoria ${props.year} — 28 de mayo (municipales)</p>
      </div>
    `;

    document.getElementById("panelContent").innerHTML = html;
    document.getElementById("sidePanel").classList.add("open");
    document.getElementById("panelBackdrop").classList.add("show");

    // Si estamos en modo oportunidad, engancha el botón "Volver al ranking".
    // El ranking ya está calculado en `state.opportunityRows` / `defense`, así
    // que solo hay que repintar el panel con `showOpportunityPanel()`.
    const back = document.getElementById("backToRanking");
    if (back) {
      back.addEventListener("click", () => showOpportunityPanel());
    }
  }

  function hidePanel() {
    document.getElementById("sidePanel").classList.remove("open");
    document.getElementById("panelBackdrop").classList.remove("show");
  }

  /* ---------- Modo oportunidad: dónde el esfuerzo es más efectivo ---------- */
  // Devuelve los partidos con votos > 0 en el año activo, ordenados por
  // total de votos desc. Cada item: { key, label, color, totalVotos }.
  function listOpportunityParties(data) {
    const totals = new Map();
    const colorBy = (data && data.palette) || {};
    for (const f of data.features) {
      for (const r of f.properties.results || []) {
        if (!r.votos || r.votos <= 0) continue;
        const k = r.siglas_canon;
        if (!k || k === "OTROS") continue; // excluimos OTROS por defecto del selector
        const cur = totals.get(k) || {
          key: k,
          label: r.siglas_canon,
          color: colorBy[k] || r.color || "#6b7280",
          totalVotos: 0,
        };
        cur.totalVotos += r.votos;
        totals.set(k, cur);
      }
    }
    return [...totals.values()].sort((a, b) => b.totalVotos - a.totalVotos);
  }

  // Calcula, para cada sección, la posición de P y los gaps hacia el
  // inmediatamente superior y hacia el líder. Excluye del ranking las
  // secciones donde P no se presenta o P ya es 1º (estas últimas van a
  // `defense`). Idempotente: se puede llamar tras cualquier cambio.
  function computeOpportunity(data, partyKey) {
    const rows = [];
    const defense = [];
    const byId = new Map();
    if (!partyKey) {
      state.opportunityRows = [];
      state.opportunityRowsById = byId;
      state.opportunityDefense = [];
      return;
    }
    for (const f of data.features) {
      const props = f.properties || {};
      const id = `${props.cdis}-${props.csec}`;
      const results = (props.results || []).slice().sort((a, b) => (b.votos || 0) - (a.votos || 0));
      if (results.length === 0) continue;
      // Posición de P: sumamos votos por siglas_canon por si la candidatura
      // aparece con denominaciones distintas (poco habitual, pero defensivo).
      const votosP = results
        .filter((r) => r.siglas_canon === partyKey)
        .reduce((s, r) => s + (r.votos || 0), 0);
      const idx = results.findIndex((r) => r.siglas_canon === partyKey);
      const ganador = results[0];
      const segundo = results[1] || null;
      const reserva = Math.max(0, (props.censo || 0) - (props.votantes || 0));
      const leaderVotos = ganador ? ganador.votos : 0;
      // pp = puntos porcentuales (sobre votos a candidaturas) entre P y referencia
      const gap_to_leader = Math.max(0, leaderVotos - votosP);
      const gap_to_next = segundo ? Math.max(0, segundo.votos - votosP) : gap_to_leader;
      const margin_leader = votosP - leaderVotos; // positivo = P ya gana
      const margin_next = votosP - (segundo ? segundo.votos : 0);
      const dificultad = reserva > 0 ? gap_to_next / reserva : null;
      const row = {
        id,
        cdis: props.cdis,
        csec: props.csec,
        censo: props.censo || 0,
        votantes: props.votantes || 0,
        candidatos: props.candidatos || 0,
        participacion_pct: props.participacion_pct || 0,
        n_mesas: props.n_mesas || 0,
        pos: idx === -1 ? null : idx + 1,
        votosP,
        ganador_siglas: ganador ? ganador.siglas_canon : "—",
        ganador_color: ganador ? ganador.color : "#6b7280",
        segundo_siglas: segundo ? segundo.siglas_canon : null,
        segundo_color: segundo ? segundo.color : "#6b7280",
        gap_votos: gap_to_next, // votos para pasar al siguiente (el inmediato superior)
        gap_to_leader_votos: gap_to_leader,
        gap_pp: props.candidatos ? (gap_to_next / props.candidatos) * 100 : 0,
        gap_to_leader_pp: props.candidatos ? (gap_to_leader / props.candidatos) * 100 : 0,
        reserva,
        dificultad,
        margin_next,
        margin_leader,
      };
      byId.set(id, row);
      if (idx === -1) continue; // P no se presenta aquí
      if (row.pos === 1) {
        defense.push(row);
        continue;
      }
      // Excluir secciones sin electores (censo=0, p.ej. secciones que no
      // constituyeron mesa) — no aportan información útil para el análisis.
      if (!row.censo || !row.candidatos) continue;
      rows.push(row);
    }
    state.opportunityRows = rows;
    state.opportunityRowsById = byId;
    state.opportunityDefense = defense;
  }

  function sortOpportunity(rows, criterio) {
    const copy = rows.slice();
    if (criterio === "dificultad") {
      // null (sin reserva) al final; menor dificultad primero
      copy.sort((a, b) => {
        if (a.dificultad == null && b.dificultad == null) return a.gap_votos - b.gap_votos;
        if (a.dificultad == null) return 1;
        if (b.dificultad == null) return -1;
        if (a.dificultad !== b.dificultad) return a.dificultad - b.dificultad;
        return a.gap_votos - b.gap_votos;
      });
    } else {
      // "gap" — menor número de votos para adelantar primero
      copy.sort((a, b) => {
        if (a.gap_votos !== b.gap_votos) return a.gap_votos - b.gap_votos;
        return a.dificultad == null ? -1 : b.dificultad == null ? 1 : a.dificultad - b.dificultad;
      });
    }
    return copy;
  }

  // Pinta el panel lateral con el ranking cuando NO hay sección
  // seleccionada: muestra controles + top-N + "A defender".
  // Si hay una sección seleccionada, muestra su fila de ranking ampliada.
  function showOpportunityPanel() {
    const party = state.opportunityParty;
    if (!party) {
      document.getElementById("panelContent").innerHTML = `
        <div class="panel-section">
          <p class="section-title">Modo oportunidad</p>
          <p style="font-size:13px;color:var(--text-muted)">Selecciona un partido arriba para ver el ranking de secciones donde el esfuerzo es más efectivo.</p>
        </div>`;
      document.getElementById("sidePanel").classList.add("open");
      document.getElementById("panelBackdrop").classList.add("show");
      return;
    }
    const rows = sortOpportunity(state.opportunityRows || [], state.opportunitySort);
    const defense = (state.opportunityDefense || []).sort(
      (a, b) => (b.margin_next || 0) - (a.margin_next || 0),
    );
    const limit = state.opportunityShowAll ? rows.length : Math.min(15, rows.length);
    const topRows = rows.slice(0, limit);
    const totalSecciones = state.geojson && state.geojson.features ? state.geojson.features.length : 0;
    const sinCandidatura = totalSecciones - rows.length - defense.length;

    const baseHex = (state.geojson && state.geojson.palette && state.geojson.palette[party]) || "#1d4ed8";
    const partyColorHtml = `<span class="dot" style="background:${baseHex}"></span><strong>${escapeHtml(party)}</strong>`;

    const sortBtn = (key, label) => {
      const active = state.opportunitySort === key ? "active" : "";
      return `<button class="sort-btn ${active}" data-sort="${key}" type="button">${label}</button>`;
    };

    const rowHtml = (r, withClick) => {
      const dStr = r.dificultad == null ? "—" : (r.dificultad * 100).toFixed(1) + "%";
      return `<tr ${withClick ? `class="opp-row" data-section="${escapeHtml(r.id)}"` : ""}>
        <td>
          <span class="pill-mini">D${r.cdis}</span>
          <span class="section-num">${r.csec}</span>
        </td>
        <td>
          <div class="party-cell">
            <span class="dot" style="background:${r.ganador_color}"></span>
            <span>${escapeHtml(r.ganador_siglas)}</span>
          </div>
        </td>
        <td class="num">${r.pos}º</td>
        <td class="num"><strong>${r.gap_votos}</strong></td>
        <td class="num muted">${r.gap_to_leader_votos || "—"}</td>
        <td class="num muted">${fmt(r.reserva)}</td>
        <td class="num">${dStr}</td>
        <td class="num muted">${(r.participacion_pct || 0).toFixed(1)}%</td>
      </tr>`;
    };

    const defHtml = (r) => `
      <tr class="opp-row" data-section="${escapeHtml(r.id)}">
        <td><span class="pill-mini">D${r.cdis}</span><span class="section-num">${r.csec}</span></td>
        <td><span style="color:${r.ganador_color}">${escapeHtml(r.ganador_siglas)}</span></td>
        <td class="num">+${r.margin_next}</td>
        <td class="num muted">${r.censo}</td>
        <td class="num muted">${(r.participacion_pct || 0).toFixed(1)}%</td>
      </tr>`;

    const headerRow = `
      <tr>
        <th>Sección</th>
        <th>Líder</th>
        <th class="num">Pos.</th>
        <th class="num" title="Votos para pasar al siguiente partido">↑ Sig.</th>
        <th class="num" title="Votos para ganar la sección">↑ 1º</th>
        <th class="num" title="Censo − votantes (abstención)">Reserva</th>
        <th class="num" title="Votos para adelantar ÷ abstención">Dif.</th>
        <th class="num">Part.</th>
      </tr>`;

    const defenseHeader = `
      <tr>
        <th>Sección</th>
        <th>Ganador</th>
        <th class="num" title="Margen en votos sobre el 2º">+Margen</th>
        <th class="num">Censo</th>
        <th class="num">Part.</th>
      </tr>`;

    const noRows =
      rows.length === 0
        ? `<p style="font-size:13px;color:var(--text-muted);margin:8px 0 0">No hay secciones donde ${escapeHtml(party)} no sea primero y necesite adelantar.</p>`
        : "";

    const seeAllBtn =
      rows.length > 15
        ? `<button class="see-all-btn" id="opportunitySeeAll" type="button">${
            state.opportunityShowAll ? "Ver solo top 15" : `Ver todas (${rows.length})`
          }</button>`
        : "";

    const html = `
      <div class="panel-section">
        <p class="section-title">Modo oportunidad · ${escapeHtml(state.year)}</p>
        <div class="winner-block" style="border-left-color:${baseHex}">
          <p class="winner-label">Partido analizado</p>
          <p class="winner-name" style="color:${baseHex}">${partyColorHtml}</p>
          <p class="winner-pct">Secciones donde el esfuerzo es más efectivo para pasar al siguiente partido</p>
        </div>
        <div class="opp-controls">
          <span class="opp-control-label">Ordenar por:</span>
          ${sortBtn("gap", "Votos para adelantar")}
          ${sortBtn("dificultad", "Dificultad (vs abstención)")}
        </div>
        <p style="font-size:11px;color:var(--text-muted);margin:4px 0 0">
          ${rows.length} secciones con margen · ${defense.length} ya ganadas${sinCandidatura > 0 ? ` · ${sinCandidatura} sin candidatura` : ""}
        </p>
      </div>

      <div class="panel-section">
        <p class="section-title">Top ${limit} — secciones asequibles</p>
        <table class="opp-table">
          <thead>${headerRow}</thead>
          <tbody>
            ${topRows.length === 0 ? `<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:14px 0">—</td></tr>` : topRows.map((r) => rowHtml(r, true)).join("")}
          </tbody>
        </table>
        ${seeAllBtn}
        ${noRows}
      </div>

      ${
        defense.length > 0
          ? `
        <div class="panel-section">
          <p class="section-title">A defender (ya 1º)</p>
          <table class="opp-table">
            <thead>${defenseHeader}</thead>
            <tbody>
              ${defense.slice(0, 10).map(defHtml).join("")}
            </tbody>
          </table>
          <p style="font-size:11px;color:var(--text-muted);margin:4px 0 0">Click en una sección del mapa o de la tabla para ver el detalle.</p>
        </div>
      `
          : ""
      }
    `;

    document.getElementById("panelContent").innerHTML = html;
    document.getElementById("sidePanel").classList.add("open");
    document.getElementById("panelBackdrop").classList.add("show");

    // Listeners de la tabla (delegación: cada fila tiene data-section)
    document.querySelectorAll("#panelContent .opp-row").forEach((tr) => {
      tr.addEventListener("click", () => {
        const id = tr.getAttribute("data-section");
        if (id) focusOnSection(id);
      });
    });
    document.querySelectorAll("#panelContent .sort-btn").forEach((b) => {
      b.addEventListener("click", () => {
        state.opportunitySort = b.getAttribute("data-sort");
        showOpportunityPanel();
      });
    });
    const seeAll = document.getElementById("opportunitySeeAll");
    if (seeAll) {
      seeAll.addEventListener("click", () => {
        state.opportunityShowAll = !state.opportunityShowAll;
        showOpportunityPanel();
      });
    }
  }

  // Activa/desactiva el modo oportunidad. Recalcula filas y repinta mapa.
  function setOpportunity(enabled) {
    state.opportunity = enabled;
    document.getElementById("opportunityToggle").setAttribute("aria-pressed", enabled ? "true" : "false");
    document.getElementById("partySelectWrap").style.display = enabled ? "" : "none";
    if (enabled) {
      // Exclusividad con el modo comparativa
      if (state.compare) {
        state.compare = false;
        const ct = document.getElementById("compareToggle");
        ct.setAttribute("aria-pressed", "false");
      }
      refreshOpportunityParty();
    } else {
      state.opportunityRows = null;
      state.opportunityRowsById = null;
      state.opportunityDefense = null;
      hidePanel();
    }
    // Repintar capa (estilo del mapa) y leyenda
    if (state.layer) {
      state.layer.eachLayer((lyr) => lyr.setStyle(styleFeature(lyr.feature)));
    }
    if (state.geojson) renderLegend(state.geojson);
    if (enabled) showOpportunityPanel();
  }

  // Asegura que state.opportunityParty es un partido presente en el año
  // activo. Si no, lo toma del ranking (el primero por total de votos).
  function refreshOpportunityParty() {
    if (!state.geojson) return;
    const parties = listOpportunityParties(state.geojson);
    const select = document.getElementById("partySelect");
    // Repoblar opciones
    select.innerHTML = parties
      .map(
        (p) =>
          `<option value="${escapeHtml(p.key)}" ${p.key === state.opportunityParty ? "selected" : ""}>${escapeHtml(p.key)} (${fmt(p.totalVotos)})</option>`,
      )
      .join("");
    if (parties.length === 0) {
      state.opportunityParty = null;
      computeOpportunity(state.geojson, null);
      return;
    }
    const existe = parties.some((p) => p.key === state.opportunityParty);
    if (!existe) state.opportunityParty = parties[0].key;
    computeOpportunity(state.geojson, state.opportunityParty);
  }

  /* ---------- Utilidades ---------- */
  function fmt(n) {
    return Number(n || 0).toLocaleString("es-ES");
  }
  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  }

  /* ---------- Panel comparativo (S6) ---------- */
  // Devuelve la firma normalizada de un partido para alinear
  // candidaturas entre años (ej. PSOE == PSOE-A, IU == PODEMOS).
  function partyGroupKey(name) {
    const n = String(name || "").toUpperCase();
    if (n.includes("PSOE")) return "PSOE-A";
    if (n.includes("PODEMOS") || n.includes("ADELANTE") || n.includes("IU") || n.includes("CSSPTT"))
      return "IZQ-PODEMOS";
    if (n.includes("PP")) return "PP";
    if (n.includes("VOX")) return "VOX";
    if (n === "CS" || n.includes("CIUDADANOS")) return "Cs";
    if (n.includes("OSP") || n.includes("SAMPEDRE")) return "OSP";
    if (n.includes("POR MI PUEBLO") || n.includes("PMP") || n.includes("PASUR")) return "POR MI PUEBLO";
    if (n.includes("IMPULSA")) return "IMPULSA CIUDAD";
    if (n.includes("UPYD")) return "UPyD";
    if (n.includes("NEODEMOCRAT")) return "NEODEMOCRAT";
    if (n.includes("PA") && !n.includes("PSOE") && !n.includes("PASUR")) return "PA";
    return n;
  }

  function getPalette(data) {
    return (data && data.palette) || {};
  }

  // Recoge, para una sección y un año, el grupo de partido con mayor % si hay varios.
  function collectByParty(data, sectionId) {
    const f = data.features.find((x) => `${x.properties.cdis}-${x.properties.csec}` === sectionId);
    if (!f) return null;
    const props = f.properties || {};
    const groups = new Map();
    for (const r of props.results || []) {
      const key = partyGroupKey(r.siglas_canon);
      const cur = groups.get(key);
      const pct = r.pct || 0;
      if (!cur || pct > cur.pct) {
        groups.set(key, {
          key,
          label: r.siglas_canon,
          color: r.color || "#6b7280",
          pct,
          votos: r.votos || 0,
        });
      }
    }
    return {
      props,
      byGroup: groups,
      winnerKey: partyGroupKey(props.winner_canon),
      winnerColor: props.winner_color,
      winnerLabel: props.winner_canon,
    };
  }

  function buildCompareRows(secsByYear) {
    // Unión de todos los grupos que aparecen en algún año (con votos > 0)
    const keys = new Set();
    for (const y of YEARS) {
      const s = secsByYear[y];
      if (!s) continue;
      for (const k of s.byGroup.keys()) {
        const v = s.byGroup.get(k);
        if (v && v.votos > 0) keys.add(k);
      }
    }
    const rows = [];
    for (const k of keys) {
      const row = { key: k, label: null, color: null, byYearPct: {}, pct: null };
      for (const y of YEARS) {
        const s = secsByYear[y];
        const v = s && s.byGroup.get(k);
        row.byYearPct[y] = v ? v.pct : null;
        if (v) {
          if (!row.label) row.label = v.label;
          if (!row.color) row.color = v.color;
        }
      }
      rows.push(row);
    }
    // Orden: por % en el último año (desc), luego por presencia
    rows.sort((a, b) => {
      const ap = a.byYearPct["2023"] ?? -1;
      const bp = b.byYearPct["2023"] ?? -1;
      if (ap !== bp) return bp - ap;
      return a.key.localeCompare(b.key);
    });
    return rows;
  }

  function deltaCell(a, b) {
    // a y b pueden ser null (partido no se presentó)
    if (a == null && b == null) {
      return `<span class="delta flat">—</span>`;
    }
    if (a == null) {
      return `<span class="delta up" title="Nuevo en este año">▲ nuevo</span>`;
    }
    if (b == null) {
      return `<span class="delta down" title="No se presenta este año">▼ fuera</span>`;
    }
    const d = b - a;
    const abs = Math.abs(d);
    if (abs < 0.05) {
      return `<span class="delta flat">≈ 0,0 pp</span>`;
    }
    if (d > 0) {
      return `<span class="delta up">▲ ${abs.toFixed(2)} pp</span>`;
    }
    return `<span class="delta down">▼ ${abs.toFixed(2)} pp</span>`;
  }

  function pctCell(v) {
    if (v == null) return `<span class="empty-cell">—</span>`;
    return `${v.toFixed(2)}%`;
  }

  function showComparePanel(sectionId) {
    const secsByYear = {};
    for (const y of YEARS) {
      const data = state.byYear[y];
      if (!data) continue;
      secsByYear[y] = collectByParty(data, sectionId);
    }
    const sec = secsByYear["2023"] || secsByYear["2019"] || secsByYear["2015"];
    if (!sec) {
      // Si no hay datos para esta sección en ningún año, fallback al panel simple
      const feat = state.featureById.get(sectionId);
      if (feat) showPanel(feat);
      return;
    }
    const rows = buildCompareRows(secsByYear);

    const winner2023Key = secsByYear["2023"] ? secsByYear["2023"].winnerKey : null;
    const winner2019Key = secsByYear["2019"] ? secsByYear["2019"].winnerKey : null;
    const winner2015Key = secsByYear["2015"] ? secsByYear["2015"].winnerKey : null;

    const metaBlock = `
      <div class="panel-section">
        <p class="section-title">Sección censal</p>
        <div class="section-id">
          <span class="pill">D${sec.props.cdis || "?"}</span>
          <h2>Sección ${sec.props.csec || "?"}</h2>
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin:6px 0 0">Modo comparativa · clic en otra sección para cambiar</p>
      </div>

      <div class="panel-section">
        <p class="section-title">Ganador por año</p>
        <div class="compare-meta">
          ${YEARS.map((y) => {
            const s = secsByYear[y];
            if (!s)
              return `<div class="meta"><div class="meta-label">${y}</div><div class="meta-value">—</div></div>`;
            return `<div class="meta">
              <div class="meta-label">${y}</div>
              <div class="meta-value" style="color:${s.winnerColor || "#6b7280"}">${escapeHtml(s.winnerLabel || "—")}</div>
              <div style="font-size:11px;color:var(--text-muted)">${(s.props.winner_pct || 0).toFixed(1)}%</div>
            </div>`;
          }).join("")}
        </div>
      </div>

      <div class="panel-section">
        <p class="section-title">Evolución por partido (% sobre votos a candidaturas)</p>
        <table class="compare-table">
          <thead>
            <tr>
              <th>Partido</th>
              <th>2015</th>
              <th>2019</th>
              <th>2023</th>
              <th>Δ 15→23</th>
              <th>Δ 19→23</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map((r) => {
                const highlight = r.key === winner2023Key ? "current-winner" : "";
                const color = r.color || "#6b7280";
                return `<tr class="${highlight}">
                  <td>
                    <div class="party-cell">
                      <span class="dot" style="background:${color}"></span>
                      <span>${escapeHtml(r.label || r.key)}</span>
                    </div>
                  </td>
                  <td>${pctCell(r.byYearPct["2015"])}</td>
                  <td>${pctCell(r.byYearPct["2019"])}</td>
                  <td>${pctCell(r.byYearPct["2023"])}</td>
                  <td>${deltaCell(r.byYearPct["2015"], r.byYearPct["2023"])}</td>
                  <td>${deltaCell(r.byYearPct["2019"], r.byYearPct["2023"])}</td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
        <p style="font-size:11px;color:var(--text-muted);margin-top:8px">
          <strong>pp</strong> = puntos porcentuales. Una fila aparece solo si el partido obtuvo votos en al menos un año en esta sección.
          ${
            winner2015Key !== winner2023Key || winner2019Key !== winner2023Key
              ? `<br>Cambio de ganador: ${escapeHtml((secsByYear["2015"] || {}).winnerLabel || "—")} → ${escapeHtml((secsByYear["2019"] || {}).winnerLabel || "—")} → ${escapeHtml((secsByYear["2023"] || {}).winnerLabel || "—")}.`
              : ""
          }
        </p>
      </div>
    `;

    document.getElementById("panelContent").innerHTML = metaBlock;
    document.getElementById("sidePanel").classList.add("open");
    document.getElementById("panelBackdrop").classList.add("show");
  }

  /* ---------- Selector de año ---------- */
  async function selectYear(year) {
    if (year === state.year && state.geojson) return;
    state.year = year;
    document
      .querySelectorAll(".year-btn")
      .forEach((b) => b.classList.toggle("active", b.dataset.year === year));
    const data = await loadYear(year);
    renderYear(data);
    hidePanel();
    // Si el modo oportunidad está activo, recalcular filas y repintar
    if (state.opportunity) {
      refreshOpportunityParty();
      repaintOpportunity();
      renderLegend(data);
      showOpportunityPanel();
    }
  }

  function wireUI() {
    document.querySelectorAll(".year-btn").forEach((btn) => {
      btn.addEventListener("click", () => selectYear(btn.dataset.year));
    });
    document.getElementById("compareToggle").addEventListener("click", () => {
      state.compare = !state.compare;
      const btn = document.getElementById("compareToggle");
      btn.setAttribute("aria-pressed", state.compare ? "true" : "false");
      // Exclusividad: si activamos comparativa, apagamos oportunidad
      if (state.compare && state.opportunity) {
        setOpportunity(false);
      }
      // Si hay panel abierto, rerenderízalo con el modo nuevo
      const open = document.getElementById("sidePanel").classList.contains("open");
      const lastId = state.lastClickedId;
      if (open && lastId) {
        if (state.compare) showComparePanel(lastId);
        else if (state.opportunity) showOpportunityPanel();
        else {
          const f = state.featureById.get(lastId);
          if (f) showPanel(f);
        }
      }
    });
    document.getElementById("opportunityToggle").addEventListener("click", () => {
      setOpportunity(!state.opportunity);
    });
    document.getElementById("partySelect").addEventListener("change", (e) => {
      state.opportunityParty = e.target.value || null;
      if (state.geojson) {
        computeOpportunity(state.geojson, state.opportunityParty);
        repaintOpportunity();
        showOpportunityPanel();
      }
    });
    document.getElementById("closePanel").addEventListener("click", hidePanel);
    document.getElementById("panelBackdrop").addEventListener("click", hidePanel);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hidePanel();
    });
  }

  /* ---------- Bootstrap ---------- */
  // Exponer state para inspección desde la consola del navegador.
  // Solo debugging; no afecta a la lógica.
  if (typeof window !== "undefined") window.__marbellaState = state;
  (async function () {
    initMap();
    wireUI();
    try {
      await preloadAllYears();
      const data = state.byYear[state.year];
      renderYear(data);
    } catch (e) {
      console.error(e);
      alert("Error cargando datos: " + e.message);
    }
  })();
})();
