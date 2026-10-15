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
          { sticky: true, opacity: 0.95 }
        );

        lyr.on("mouseover", () => lyr.setStyle(highlightStyle()));
        lyr.on("mouseout", () => lyr.setStyle(styleFeature(feature)));
        lyr.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          showPanel(feature);
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
      items.push(`<span class="legend-item"><span class="legend-swatch" style="background:${color}"></span>${sigla}</span>`);
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
            `
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
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ---------- Selector de año ---------- */
  async function selectYear(year) {
    if (year === state.year && state.geojson) return;
    state.year = year;
    document.querySelectorAll(".year-btn").forEach((b) => b.classList.toggle("active", b.dataset.year === year));
    const data = await loadYear(year);
    renderYear(data);
    hidePanel();
  }

  function wireUI() {
    document.querySelectorAll(".year-btn").forEach((btn) => {
      btn.addEventListener("click", () => selectYear(btn.dataset.year));
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
      const data = await loadYear(state.year);
      renderYear(data);
    } catch (e) {
      console.error(e);
      alert("Error cargando datos: " + e.message);
    }
  })();
})();
