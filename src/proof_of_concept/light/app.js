import * as maplibregl from "https://unpkg.com/maplibre-gl@6.13.0/dist/maplibre-gl.mjs";

// Kicked off immediately so it runs in parallel with the style fetch below,
// rather than waiting behind it - these two requests have nothing to do with
// each other.
const manifestPromise = fetch("data/projects.json").then((r) => r.json());

// Recolors OpenFreeMap's Positron style into an antique-survey palette
// (parchment paper, sepia roads/labels, muted sage land, teal water) -
// inspired by old Bangalore cantonment survey maps. Only *-color paint
// properties are overridden; any existing zoom-based width/opacity
// expressions on those layers are left untouched.
async function buildAntiqueStyle() {
  const style = await fetch("https://tiles.openfreemap.org/styles/positron").then((r) => r.json());

  const PARCHMENT = "#EDE0BE";
  const PARCHMENT_DARK = "#E3D3A0";
  const SEPIA = "#3E2E1E";
  const SEPIA_MUTED = "#6B5538";
  const RUST = "#B37F63";
  const RUST_DEEP = "#9C6750";
  const TEAL = "#6FAFA0";
  const SAGE = "#93A86B";
  const OCHRE = "#C9A769";
  // Minor streets need to recede, not compete with the major-road/label
  // hierarchy - Positron's own default keeps them near-invisible (light
  // grey at low weight) for the same reason; a saturated colour at full
  // opacity on every residential street turns the whole map into a brown
  // smear, especially over dense city grids.
  const MINOR_TAN = "#C7A97C";

  const layerOverrides = {
    background: { "background-color": PARCHMENT },
    park: { "fill-color": SAGE, "fill-opacity": 0.35 },
    water: { "fill-color": TEAL },
    waterway: { "line-color": TEAL },
    landcover_wood: { "fill-color": SAGE, "fill-opacity": 0.45 },
    landuse_residential: { "fill-color": PARCHMENT_DARK, "fill-opacity": 0.6 },
    building: { "fill-color": OCHRE, "fill-outline-color": RUST_DEEP, "fill-opacity": 0.5 },
    road_area_pier: { "fill-color": PARCHMENT_DARK },
    road_pier: { "line-color": SEPIA_MUTED },
    highway_path: { "line-color": MINOR_TAN, "line-opacity": 0.5 },
    highway_minor: { "line-color": MINOR_TAN, "line-opacity": 0.55 },
    highway_major_casing: { "line-color": RUST_DEEP },
    highway_major_inner: { "line-color": RUST },
    highway_major_subtle: { "line-color": RUST },
    highway_motorway_casing: { "line-color": RUST_DEEP },
    highway_motorway_inner: { "line-color": RUST },
    highway_motorway_subtle: { "line-color": RUST },
    railway: { "line-color": SEPIA_MUTED, "line-opacity": 0.6 },
    railway_dashline: { "line-color": SEPIA_MUTED, "line-opacity": 0.6 },
    railway_service: { "line-color": SEPIA_MUTED, "line-opacity": 0.5 },
    railway_service_dashline: { "line-color": SEPIA_MUTED, "line-opacity": 0.5 },
    railway_transit: { "line-color": SEPIA_MUTED, "line-opacity": 0.6 },
    railway_transit_dashline: { "line-color": SEPIA_MUTED, "line-opacity": 0.6 },
    boundary_2: { "line-color": SEPIA_MUTED },
    boundary_3: { "line-color": SEPIA_MUTED },
    boundary_disputed: { "line-color": SEPIA_MUTED },
  };

  const textLayerIds = new Set([
    "waterway_line_label",
    "water_name_point_label",
    "water_name_line_label",
    "highway-name-path",
    "highway-name-minor",
    "highway-name-major",
    "airport",
    "label_other",
    "label_village",
    "label_town",
    "label_state",
    "label_city",
    "label_city_capital",
    "label_country_3",
    "label_country_2",
    "label_country_1",
  ]);
  const textOverride = { "text-color": SEPIA, "text-halo-color": PARCHMENT, "text-halo-width": 1.2 };

  for (const layer of style.layers) {
    if (layerOverrides[layer.id]) {
      layer.paint = { ...layer.paint, ...layerOverrides[layer.id] };
    }
    if (textLayerIds.has(layer.id)) {
      layer.paint = { ...layer.paint, ...textOverride };
    }
  }

  return style;
}

// `map` is assigned once the style finishes building, but nothing else in
// this file blocks on that - panel/row rendering only needs manifestPromise,
// not the map, so the two run fully in parallel. Code that genuinely needs
// the map (loadProjectLayers) waits on `mapReady` instead of a top-level
// await, which would otherwise stall registering the manifestPromise
// handler below until the external style fetch finished.
let map;
const mapReady = buildAntiqueStyle().then((style) => {
  map = new maplibregl.Map({
    container: "map",
    style,
    center: [77.61, 13.0],
    zoom: 11,
  });
  map.addControl(new maplibregl.NavigationControl(), "top-right");
  return map;
});

const projectListEl = document.getElementById("project-list");
const grandTotalFigureEl = document.getElementById("grand-total-figure");
const grandTotalLabelEl = document.getElementById("grand-total-label");

// Trees get their own shade of green per corridor. The boundary/buffer
// outline is a *different* colour per corridor, deliberately not green -
// green on the parchment basemap's sage land cover just disappears, so the
// polygon needs a colour that actually pops against parchment/sage/rust.
const PROJECT_COLORS = {
  "yeshwantpur-kr-puram": "#2E7D4F",
  "old-madras-road-to-silk-board": "#7C9A3C",
};
const FALLBACK_COLORS = ["#3F8F6B", "#4A6B3A", "#5FA089", "#2F6B52"];

const PROJECT_LINE_COLORS = {
  "yeshwantpur-kr-puram": "#2C5F8A",
  "old-madras-road-to-silk-board": "#6B4C8A",
};
const FALLBACK_LINE_COLORS = ["#2C5F8A", "#6B4C8A", "#8A4C5F", "#4C6B8A"];

const BUFFERS_M = [5, 10, 15];

const BASE_TREE_COUNT_LABEL = "trees across visible corridors";

const projects = {}; // slug -> state

function colorFor(slug, index) {
  return PROJECT_COLORS[slug] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function lineColorFor(slug, index) {
  return PROJECT_LINE_COLORS[slug] || FALLBACK_LINE_COLORS[index % FALLBACK_LINE_COLORS.length];
}

function statusLabel(status) {
  if (status === 1 || status === "1") return "Active";
  if (status === 0 || status === "0") return "Removed";
  return "Unverified";
}

function treeCardHtml(props, project, riskBand) {
  const flagText = riskBand ? `Within +${riskBand}m construction margin` : "Within published project boundary";
  return `
    <div class="tree-card-row" style="margin-top:0;">
      <span><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${project.color};margin-right:5px;"></span>${project.name}</span>
    </div>
    <span class="tree-card-species">${props.species || "Unidentified species"}</span>
    <div class="tree-card-row"><span>Ward</span><b>${props.ward ?? "—"}</b></div>
    <div class="tree-card-row"><span>Tree ID</span><b>${props.tree_id ?? "—"}</b></div>
    <div class="tree-card-row"><span>Status</span><b>${statusLabel(props.status)}</b></div>
    <div class="tree-card-flag">${flagText}</div>
  `;
}

function treeSvg(color) {
  return `
    <svg width="24" height="24" viewBox="0 0 640 640" xmlns="http://www.w3.org/2000/svg">
      <path fill="${color}" d="M320 32C327 32 333.7 35.1 338.3 40.5L474.3 200.5C480.4 207.6 481.7 217.6 477.8 226.1C473.9 234.6 465.4 240 456 240L431.1 240L506.3 328.5C512.4 335.6 513.7 345.6 509.8 354.1C505.9 362.6 497.4 368 488 368L449.5 368L538.3 472.5C544.4 479.6 545.7 489.6 541.8 498.1C537.9 506.6 529.4 512 520 512L352 512L352 576C352 593.7 337.7 608 320 608C302.3 608 288 593.7 288 576L288 512L120 512C110.6 512 102.1 506.6 98.2 498.1C94.3 489.6 95.6 479.6 101.7 472.5L190.5 368L152 368C142.6 368 134.1 362.6 130.2 354.1C126.3 345.6 127.6 335.6 133.7 328.5L208.9 240L184 240C174.6 240 166.1 234.6 162.2 226.1C158.3 217.6 159.6 207.6 165.7 200.5L301.7 40.5C306.3 35.1 313 32 320 32z"/>
    </svg>`;
}

function makeTreeMarker(feature, project, riskBand) {
  const [lon, lat] = feature.geometry.coordinates;
  const el = document.createElement("div");
  el.className = "tree-icon";
  el.innerHTML = treeSvg(project.color);

  const popup = new maplibregl.Popup({ offset: 16, className: "tree-card" }).setHTML(
    treeCardHtml(feature.properties, project, riskBand)
  );

  return new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([lon, lat]).setPopup(popup);
}

function setMarkersOnMap(markers, show) {
  for (const marker of markers) {
    if (show) marker.addTo(map);
    else marker.remove();
  }
}

// Bands are cumulative (+10m already contains everything +5m has), so at
// most one is ever meaningfully "on" per project - checking a new one clears
// the others (see the change listener below). This returns that one band, if
// any.
function checkedBuffer(slug) {
  const p = projects[slug];
  for (const d of BUFFERS_M) {
    if (p.buffers[d]?.checkbox?.checked) return d;
  }
  return null;
}

function projectSubtotal(slug) {
  const p = projects[slug];
  const d = checkedBuffer(slug);
  return d === null ? p.baseTreeCount : p.baseTreeCount + p.buffers[d].count;
}

function refreshProjectCount(slug) {
  const d = checkedBuffer(slug);
  const countEl = document.getElementById(`project-count-${slug}`);
  const labelEl = document.getElementById(`project-count-label-${slug}`);
  if (!countEl) return; // row not built yet
  countEl.textContent = projectSubtotal(slug).toLocaleString();
  labelEl.textContent = d === null ? "in boundary" : `in boundary +${d}m`;
}

function updateGrandTotal() {
  let total = 0;
  let anyVisible = false;
  for (const slug in projects) {
    const p = projects[slug];
    if (!p.visible) continue;
    anyVisible = true;
    total += projectSubtotal(slug);
  }
  grandTotalFigureEl.textContent = anyVisible ? total.toLocaleString() : "0";
  grandTotalLabelEl.textContent = anyVisible ? BASE_TREE_COUNT_LABEL : "no corridors visible";
}

function setLayerVisibility(layerId, visible) {
  if (map.getLayer(layerId)) {
    map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
  }
}

function setProjectVisibility(slug, visible) {
  const p = projects[slug];
  p.visible = visible;

  const switchEl = document.getElementById(`switch-${slug}`);
  switchEl.classList.toggle("on", visible);

  if (!p.loaded) return; // layers not built yet; applied once they are

  setLayerVisibility(`boundary-fill-${slug}`, visible);
  setLayerVisibility(`boundary-line-${slug}`, visible);
  setMarkersOnMap(p.baseMarkers, visible);

  for (const d of BUFFERS_M) {
    const b = p.buffers[d];
    if (!b) continue;
    const showBand = visible && !!b.checkbox?.checked;
    setLayerVisibility(`buffer-ring-${slug}-${d}`, showBand);
    setMarkersOnMap(b.markers, showBand);
  }
}

function buildProjectRow(manifestEntry, index) {
  const slug = manifestEntry.slug;
  const color = colorFor(slug, index);
  const lineColor = lineColorFor(slug, index);
  const cumulative = manifestEntry.cumulative_counts_by_buffer_m;
  const hasAnyTrees = cumulative[15] > 0;

  const row = document.createElement("div");
  row.className = "project-row";

  const buffersHtml = hasAnyTrees
    ? `<div class="project-buffers">
        ${BUFFERS_M.map(
          (d) => `
          <label class="buffer-row">
            <input type="checkbox" id="buffer-${slug}-${d}" />
            <span class="buffer-swatch" style="background:${color}"></span>
            +${d}m margin
            <span class="buffer-row-count" id="buffer-${slug}-${d}-count">${cumulative[d].toLocaleString()} total</span>
          </label>`
        ).join("")}
      </div>`
    : `<p class="project-empty-note">No census trees found along this alignment (within 15m).</p>`;

  row.innerHTML = `
    <div class="project-row-main" id="row-main-${slug}" tabindex="0" role="switch" aria-checked="true" aria-label="Show ${manifestEntry.name} on the map">
      <span class="project-color-bar" style="background:${color}"></span>
      <div class="project-row-info">
        <div class="project-name">${manifestEntry.name}</div>
        <div class="project-meta"><a href="${manifestEntry.source_url}" target="_blank" rel="noopener">View alignment on OpenCity</a></div>
      </div>
      <div class="project-count-block">
        <span class="project-count" id="project-count-${slug}">${manifestEntry.total_trees_in_boundary.toLocaleString()}</span>
        <span class="project-count-label" id="project-count-label-${slug}">in boundary</span>
      </div>
      <span class="project-switch on" id="switch-${slug}"></span>
    </div>
    ${buffersHtml}
  `;

  projectListEl.appendChild(row);

  projects[slug] = {
    color,
    lineColor,
    visible: true,
    loaded: false,
    baseTreeCount: manifestEntry.total_trees_in_boundary,
    baseMarkers: [],
    buffers: {},
  };

  const rowMain = document.getElementById(`row-main-${slug}`);
  const toggleRow = () => {
    const nowVisible = !projects[slug].visible;
    setProjectVisibility(slug, nowVisible);
    rowMain.setAttribute("aria-checked", String(nowVisible));
    updateGrandTotal();
  };
  rowMain.addEventListener("click", (e) => {
    if (e.target.tagName === "A") return;
    toggleRow();
  });
  rowMain.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleRow();
    }
  });

  if (hasAnyTrees) {
    for (const d of BUFFERS_M) {
      const checkbox = document.getElementById(`buffer-${slug}-${d}`);
      checkbox.addEventListener("change", () => {
        const p = projects[slug];

        // Bands are cumulative, so only one makes sense on at a time -
        // checking one clears (and hides) every other band for this project
        // instead of layering duplicate markers on top of each other.
        if (checkbox.checked) {
          for (const other of BUFFERS_M) {
            if (other === d) continue;
            const otherCheckbox = document.getElementById(`buffer-${slug}-${other}`);
            if (otherCheckbox) otherCheckbox.checked = false;
            const ob = p.buffers[other];
            if (ob) {
              setLayerVisibility(`buffer-ring-${slug}-${other}`, false);
              setMarkersOnMap(ob.markers, false);
            }
          }
        }

        const b = p.buffers[d];
        if (b) {
          const show = checkbox.checked && p.visible;
          setLayerVisibility(`buffer-ring-${slug}-${d}`, show);
          setMarkersOnMap(b.markers, show);
        }
        // else: data still loading, layers get applied once loadProjectLayers finishes

        refreshProjectCount(slug);
        updateGrandTotal();
      });
    }
  }
}

function extendBoundsWithGeoJSON(bounds, fc) {
  const walk = (coords) => {
    if (typeof coords[0] === "number") {
      bounds.extend(coords);
    } else {
      for (const c of coords) walk(c);
    }
  };
  for (const feature of fc.features) walk(feature.geometry.coordinates);
}

function loadProjectLayers(manifestEntry) {
  const slug = manifestEntry.slug;
  const project = { name: manifestEntry.name, color: projects[slug].color, lineColor: projects[slug].lineColor };
  const base = `data/${slug}/`;

  return Promise.all([
    fetch(base + "corridor_boundary.geojson").then((r) => r.json()),
    fetch(base + "corridor_trees.geojson").then((r) => r.json()),
    fetch(base + "corridor_buffers.geojson").then((r) => r.json()),
    fetch(base + "corridor_buffer_trees.geojson").then((r) => r.json()),
  ]).then(([boundaryFc, treesFc, buffersFc, bufferTreesFc]) => {
    const p = projects[slug];
    const vis = p.visible ? "visible" : "none";

    map.addSource(`boundary-${slug}`, { type: "geojson", data: boundaryFc });
    map.addLayer({
      id: `boundary-fill-${slug}`,
      type: "fill",
      source: `boundary-${slug}`,
      paint: { "fill-color": project.lineColor, "fill-opacity": 0.07 },
      layout: { visibility: vis },
    });
    map.addLayer({
      id: `boundary-line-${slug}`,
      type: "line",
      source: `boundary-${slug}`,
      paint: { "line-color": project.lineColor, "line-width": 2 },
      layout: { visibility: vis },
    });

    p.baseTreeCount = treesFc.features.length;
    p.baseMarkers = treesFc.features.map((f) => makeTreeMarker(f, project, 0));
    setMarkersOnMap(p.baseMarkers, p.visible);

    map.addSource(`buffers-${slug}`, { type: "geojson", data: buffersFc });

    for (const d of BUFFERS_M) {
      map.addLayer({
        id: `buffer-ring-${slug}-${d}`,
        type: "line",
        source: `buffers-${slug}`,
        filter: ["==", ["get", "buffer_m"], d],
        paint: { "line-color": project.lineColor, "line-width": 1.5, "line-dasharray": [2, 1.5] },
        layout: { visibility: "none" },
      });

      const treeFeatures = bufferTreesFc.features.filter((f) => f.properties.band_m <= d);
      const markers = treeFeatures.map((f) => makeTreeMarker(f, project, d));

      const checkbox = document.getElementById(`buffer-${slug}-${d}`);
      const countLabel = document.getElementById(`buffer-${slug}-${d}-count`);
      if (countLabel) {
        countLabel.textContent = `${(p.baseTreeCount + treeFeatures.length).toLocaleString()} total`;
      }

      p.buffers[d] = { markers, count: treeFeatures.length, checkbox };
      if (checkbox?.checked && p.visible) setMarkersOnMap(markers, true);
    }

    p.loaded = true;
    refreshProjectCount(slug);

    const bounds = new maplibregl.LngLatBounds();
    extendBoundsWithGeoJSON(bounds, boundaryFc);
    return bounds;
  });
}

manifestPromise
  .then((manifest) => {
    // Rows render as soon as the manifest arrives - no reason to wait on the
    // map/style fetch for this part.
    projectListEl.innerHTML = "";
    manifest.forEach((entry, i) => buildProjectRow(entry, i));
    maybeAutoStartTour();

    return mapReady.then((map) => {
      const whenMapLoaded = map.loaded() ? Promise.resolve() : new Promise((resolve) => map.once("load", resolve));

      return whenMapLoaded
        .then(() => Promise.all(manifest.map((entry) => loadProjectLayers(entry))))
        .then((boundsList) => {
          const combined = new maplibregl.LngLatBounds();
          for (const b of boundsList) combined.extend(b);
          map.fitBounds(combined, { padding: 40, duration: 0 });
          updateGrandTotal();
        });
    });
  })
  .catch((err) => {
    projectListEl.innerHTML = '<p class="loading-row">Failed to load corridor data.</p>';
    console.error(err);
  });

// --- Guided tour (Driver.js: spotlight one section at a time, dim the rest) -

const TOUR_SEEN_KEY = "flyovercensus_tour_seen_v1";

function tourSteps() {
  return [
    {
      element: "#panel-header",
      popover: {
        title: "Flyovers, counted in trees",
        description:
          "Every upcoming elevated-corridor project on OpenCity, spatially joined against the BBMP tree census - how many trees sit inside each published boundary.",
      },
    },
    {
      element: "#grand-total",
      popover: {
        title: "A live total",
        description: "Updates as you show or hide corridors, or widen a buffer band - always exactly what's currently visible on the map.",
      },
    },
    {
      element: ".project-row-main",
      popover: {
        title: "Toggle a corridor",
        description: "Tap a row to show or hide that corridor on the map.",
      },
    },
    {
      element: ".project-buffers",
      popover: {
        title: "Buffer bands",
        description: "+5/10/15m are cumulative, so only one is ever meaningfully on - opening +10m replaces +5m instead of stacking on top of it.",
      },
    },
    {
      element: "#map",
      popover: {
        title: "Tap a tree",
        description: "Every tree is coloured by which corridor it belongs to. Tap one for its species, ward, tree ID, and status.",
      },
    },
    {
      element: "#project-list + .note",
      popover: {
        title: "Read it as an estimate",
        description:
          "Buffers approximate a wider construction margin, not a surveyed alignment - and marked trees are a GIS estimate, not a confirmed felling list.",
      },
    },
  ].filter((s) => document.querySelector(s.element));
}

// Loaded lazily, on first actual use - a static top-level import would make
// the whole module (manifest fetch included) wait on this CDN fetch before
// running at all, for a feature most page loads never open.
let driverLibPromise = null;
function loadDriverLib() {
  if (!driverLibPromise) {
    driverLibPromise = import("https://cdn.jsdelivr.net/npm/driver.js@1.9.0/dist/driver.js.mjs").then((m) => m.driver);
  }
  return driverLibPromise;
}

function startTour() {
  const steps = tourSteps();
  if (!steps.length) return;
  loadDriverLib().then((driver) => {
    driver({
      showProgress: true,
      overlayColor: "#2D2114",
      overlayOpacity: 0.72,
      stagePadding: 6,
      stageRadius: 10,
      nextBtnText: "Next",
      prevBtnText: "Back",
      doneBtnText: "Done",
      onDestroyed: () => {
        try {
          localStorage.setItem(TOUR_SEEN_KEY, "1");
        } catch {
          // private browsing / storage disabled - fine to just not persist
        }
      },
      steps,
    }).drive();
  });
}

function maybeAutoStartTour() {
  if (localStorage.getItem(TOUR_SEEN_KEY)) return;
  startTour();
}

document.getElementById("tour-trigger").addEventListener("click", startTour);
