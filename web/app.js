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

        // Popup ligero al hover
        const winner = props.winner_canon || "—";
        const pct = props.winner_pct || 0;
        lyr.bindTooltip(
          `<strong>${winner}</strong> ${pct.toFixed(1)}%<br><small>Sección ${props.cdis}-${props.csec || "?"}</small>`,
          { sticky: true, opacity: 0.95 },
        );

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

  /* ---------- Leyenda ---------- */
  function renderLegend(data) {
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

  /* ---------- Panel lateral con detalle ---------- */
  function showPanel(feature) {
    const props = feature.properties || {};
    const color = props.winner_color || "#9ca3af";
    const winner = props.winner_canon || "—";
    const results = (props.results || []).filter((r) => r.votos > 0);

    const html = `
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
  }

  function hidePanel() {
    document.getElementById("sidePanel").classList.remove("open");
    document.getElementById("panelBackdrop").classList.remove("show");
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
  }

  function wireUI() {
    document.querySelectorAll(".year-btn").forEach((btn) => {
      btn.addEventListener("click", () => selectYear(btn.dataset.year));
    });
    document.getElementById("compareToggle").addEventListener("click", () => {
      state.compare = !state.compare;
      const btn = document.getElementById("compareToggle");
      btn.setAttribute("aria-pressed", state.compare ? "true" : "false");
      // Si hay panel abierto, rerenderízalo con el modo nuevo
      const open = document.getElementById("sidePanel").classList.contains("open");
      const lastId = state.lastClickedId;
      if (open && lastId) {
        if (state.compare) showComparePanel(lastId);
        else {
          const f = state.featureById.get(lastId);
          if (f) showPanel(f);
        }
      }
    });
    document.getElementById("closePanel").addEventListener("click", hidePanel);
    document.getElementById("panelBackdrop").addEventListener("click", hidePanel);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hidePanel();
    });
  }

  /* ---------- Bootstrap ---------- */
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
