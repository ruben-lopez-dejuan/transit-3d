import {
  GeoJSONSource,
  LngLatBounds,
  Map,
  NavigationControl,
  Popup,
  setWorkerUrl,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";

import "./style.css";

import { createBusImage } from "./map/busIcon";
import { VehicleAnimator } from "./map/vehicleAnimator";
import {
  getActiveRoute,
  getRoutes,
  getVehicles,
} from "./transit/api";
import type {
  ActiveRouteResponse,
  TransitRoute,
} from "./transit/types";

const EMPTY_GEOJSON = {
  type: "FeatureCollection" as const,
  features: [],
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function asHex(value: string) {
  return `#${value.replace("#", "")}`;
}

function formatTimestamp(
  timestamp: number | null,
) {
  if (!timestamp) return "—";

  return new Date(
    timestamp * 1000,
  ).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

document.querySelector<HTMLDivElement>(
  "#app",
)!.innerHTML = `
  <div id="map"></div>

  <aside class="panel">
    <div class="eyebrow">
      BILBAO TRANSIT 3D · BIZKAIBUS
    </div>

    <h1>Bizkaibus Live</h1>

    <p class="subtitle">
      Vehículos reales, recorridos GTFS y paradas activas.
    </p>

    <label for="route-select">
      Línea
    </label>

    <select id="route-select">
      <option value="">
        Cargando líneas…
      </option>
    </select>

    <section
      id="route-card"
      class="route-card hidden"
    >
      <div
        id="route-badge"
        class="route-badge"
      >
        —
      </div>

      <div class="route-copy">
        <strong id="route-name">
          —
        </strong>

        <span id="route-meta">
          —
        </span>
      </div>
    </section>

    <div class="stats">
      <div>
        <span>Buses</span>
        <strong id="vehicle-count">
          —
        </strong>
      </div>

      <div>
        <span>Paradas</span>
        <strong id="stop-count">
          —
        </strong>
      </div>

      <div>
        <span>Último dato</span>
        <strong id="feed-time">
          —
        </strong>
      </div>
    </div>

    <div id="status" class="status">
      <span class="status-dot"></span>
      <span class="status-text">
        Conectando…
      </span>
    </div>

    <button id="fit-route" type="button">
      Centrar recorrido
    </button>
  </aside>

  <div class="legend">
    <span>
      <i class="legend-bus"></i>
      Bus
    </span>

    <span>
      <i class="legend-stop"></i>
      Parada
    </span>
  </div>
`;

const routeSelect =
  document.querySelector<HTMLSelectElement>(
    "#route-select",
  )!;

const routeCard =
  document.querySelector<HTMLElement>(
    "#route-card",
  )!;

const routeBadge =
  document.querySelector<HTMLElement>(
    "#route-badge",
  )!;

const routeName =
  document.querySelector<HTMLElement>(
    "#route-name",
  )!;

const routeMeta =
  document.querySelector<HTMLElement>(
    "#route-meta",
  )!;

const vehicleCount =
  document.querySelector<HTMLElement>(
    "#vehicle-count",
  )!;

const stopCount =
  document.querySelector<HTMLElement>(
    "#stop-count",
  )!;

const feedTime =
  document.querySelector<HTMLElement>(
    "#feed-time",
  )!;

const status =
  document.querySelector<HTMLElement>(
    "#status",
  )!;

const statusText =
  document.querySelector<HTMLElement>(
    ".status-text",
  )!;

const fitRouteButton =
  document.querySelector<HTMLButtonElement>(
    "#fit-route",
  )!;

setWorkerUrl(workerUrl);

const map = new Map({
  container: "map",
  style:
    "https://tiles.openfreemap.org/styles/liberty",
  center: [-2.96, 43.30],
  zoom: 10.8,
  pitch: 55,
  bearing: -18,
  canvasContextAttributes: {
    antialias: true,
  },
});

map.addControl(
  new NavigationControl({
    visualizePitch: true,
  }),
  "bottom-right",
);

let currentRouteId: string | null = null;
let currentRoute:
  | ActiveRouteResponse
  | null = null;

let pollTimer:
  | number
  | null = null;

let animator:
  | VehicleAnimator
  | null = null;

function setStatus(
  text: string,
  state: "live" | "error" | "" = "",
) {
  status.className =
    `status ${state}`.trim();

  statusText.textContent = text;
}

function getSource(id: string) {
  return map.getSource(id) as GeoJSONSource;
}

function add3DBuildings() {
  try {
    if (
      !map.getSource("openmaptiles") ||
      map.getLayer("3d-buildings")
    ) {
      return;
    }

    const firstLabelLayer =
      map
        .getStyle()
        .layers
        ?.find(
          (layer) =>
            layer.type === "symbol" &&
            layer.layout?.["text-field"],
        );

    map.addLayer(
      {
        id: "3d-buildings",
        source: "openmaptiles",
        "source-layer": "building",
        type: "fill-extrusion",
        minzoom: 14,
        paint: {
          "fill-extrusion-color":
            "#d7dde2",
          "fill-extrusion-opacity":
            0.72,
          "fill-extrusion-height": [
            "interpolate",
            ["linear"],
            ["zoom"],
            14,
            0,
            15.2,
            [
              "coalesce",
              ["get", "render_height"],
              10,
            ],
          ],
          "fill-extrusion-base": [
            "coalesce",
            ["get", "render_min_height"],
            0,
          ],
        },
      },
      firstLabelLayer?.id,
    );
  } catch (error) {
    console.warn(
      "3D buildings unavailable:",
      error,
    );
  }
}

function installBusImage(route: TransitRoute) {
  const imageName = "bizkaibus-model";

  if (map.hasImage(imageName)) {
    map.removeImage(imageName);
  }

  map.addImage(
    imageName,
    createBusImage(
      asHex(route.color),
      route.shortName,
    ),
    {
      pixelRatio: 2,
    },
  );
}

function ensureLayers() {
  for (const id of [
    "active-route",
    "active-stops",
    "live-buses",
  ]) {
    if (!map.getSource(id)) {
      map.addSource(id, {
        type: "geojson",
        data: EMPTY_GEOJSON,
      });
    }
  }

  if (!map.hasImage("bizkaibus-model")) {
    map.addImage(
      "bizkaibus-model",
      createBusImage(
        "#d6203a",
        "BB",
      ),
      {
        pixelRatio: 2,
      },
    );
  }

  if (!map.getLayer("route-glow")) {
    map.addLayer({
      id: "route-glow",
      type: "line",
      source: "active-route",
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": "#ffffff",
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          9,
          4,
          15,
          10,
        ],
        "line-opacity": 0.40,
        "line-blur": 2,
      },
    });
  }

  if (!map.getLayer("route-main")) {
    map.addLayer({
      id: "route-main",
      type: "line",
      source: "active-route",
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": "#0067A8",
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          9,
          2,
          15,
          6,
        ],
        "line-opacity": 0.96,
      },
    });
  }

  if (!map.getLayer("stop-halo")) {
    map.addLayer({
      id: "stop-halo",
      type: "circle",
      source: "active-stops",
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          3.5,
          15,
          7,
        ],
        "circle-color": "#102332",
        "circle-opacity": 0.96,
      },
    });
  }

  if (!map.getLayer("stops")) {
    map.addLayer({
      id: "stops",
      type: "circle",
      source: "active-stops",
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          2,
          15,
          4.5,
        ],
        "circle-color": "#ffffff",
        "circle-stroke-color":
          "#ffffff",
        "circle-stroke-width": 1,
      },
    });
  }

  if (!map.getLayer("stop-labels")) {
    map.addLayer({
      id: "stop-labels",
      type: "symbol",
      source: "active-stops",
      minzoom: 13,
      layout: {
        "text-field": ["get", "name"],
        "text-size": 11,
        "text-offset": [0, 1.1],
        "text-anchor": "top",
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#102332",
        "text-halo-color":
          "rgba(255,255,255,.96)",
        "text-halo-width": 2,
      },
    });
  }

  if (!map.getLayer("bus-shadow")) {
    map.addLayer({
      id: "bus-shadow",
      type: "circle",
      source: "live-buses",
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          4,
          15,
          8,
        ],
        "circle-color":
          "rgba(0,0,0,.25)",
        "circle-blur": 0.7,
        "circle-translate": [2, 4],
      },
    });
  }

  if (!map.getLayer("buses")) {
    map.addLayer({
      id: "buses",
      type: "symbol",
      source: "live-buses",
      layout: {
        "icon-image": "bizkaibus-model",
        "icon-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          9,
          0.42,
          13,
          0.62,
          16,
          0.88,
        ],
        "icon-rotate": ["get", "bearing"],
        "icon-rotation-alignment":
          "map",
        "icon-pitch-alignment":
          "map",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });
  }
}

function registerMapInteractions() {
  map.on("click", "stops", (event) => {
    const feature = event.features?.[0];

    if (!feature) return;

    const properties =
      feature.properties ?? {};

    new Popup({
      offset: 12,
    })
      .setLngLat(
        (
          feature.geometry as {
            coordinates: [number, number];
          }
        ).coordinates,
      )
      .setHTML(`
        <div class="popup-kicker">
          Parada Bizkaibus
        </div>

        <div class="popup-title">
          ${escapeHtml(properties.name)}
        </div>

        ${
          properties.stopCode
            ? `
              <div class="popup-row">
                <strong>Código:</strong>
                ${escapeHtml(properties.stopCode)}
              </div>
            `
            : ""
        }

        <div class="popup-row">
          <strong>Línea:</strong>
          ${escapeHtml(properties.routeShortName)}
        </div>

        ${
          properties.headsigns
            ? `
              <div class="popup-row">
                <strong>Direcciones:</strong>
                ${escapeHtml(properties.headsigns)}
              </div>
            `
            : ""
        }
      `)
      .addTo(map);
  });

  map.on("click", "buses", (event) => {
    const feature = event.features?.[0];

    if (!feature) return;

    const properties =
      feature.properties ?? {};

    new Popup({
      offset: 20,
    })
      .setLngLat(
        (
          feature.geometry as {
            coordinates: [number, number];
          }
        ).coordinates,
      )
      .setHTML(`
        <div class="popup-kicker">
          Bus en servicio
        </div>

        <div class="popup-title">
          ${escapeHtml(properties.routeShortName)}
          ${
            properties.headsign
              ? ` · ${escapeHtml(properties.headsign)}`
              : ""
          }
        </div>

        <div class="popup-row">
          <strong>Vehículo:</strong>
          ${escapeHtml(properties.vehicleId || "—")}
        </div>

        ${
          properties.stopName
            ? `
              <div class="popup-row">
                <strong>Parada de referencia:</strong>
                ${escapeHtml(properties.stopName)}
              </div>
            `
            : ""
        }

        <div class="popup-row">
          <strong>Actualizado:</strong>
          ${escapeHtml(
            formatTimestamp(
              Number(properties.timestamp) ||
              null,
            ),
          )}
        </div>

        <div class="popup-row">
          <strong>Error GPS→recorrido:</strong>
          ${Math.round(
            Number(
              properties.distanceToShapeMeters ||
              0,
            ),
          )} m
        </div>
      `)
      .addTo(map);
  });

  for (const layer of ["stops", "buses"]) {
    map.on(
      "mouseenter",
      layer,
      () => {
        map.getCanvas().style.cursor =
          "pointer";
      },
    );

    map.on(
      "mouseleave",
      layer,
      () => {
        map.getCanvas().style.cursor = "";
      },
    );
  }
}

function fitCurrentRoute() {
  const features =
    currentRoute?.shapes.features ?? [];

  if (features.length === 0) return;

  const bounds =
    new LngLatBounds();

  let hasCoordinate = false;

  for (const feature of features) {
    if (
      feature.geometry.type !==
      "LineString"
    ) {
      continue;
    }

    for (const coordinate of
      feature.geometry.coordinates) {
      bounds.extend(coordinate);
      hasCoordinate = true;
    }
  }

  if (!hasCoordinate) return;

  map.fitBounds(bounds, {
    padding: {
      top: 90,
      right: 70,
      bottom: 70,
      left:
        window.innerWidth > 700
          ? 440
          : 40,
    },
    maxZoom: 14.7,
    pitch: 55,
    duration: 1100,
  });
}

async function refreshVehicles() {
  if (!currentRouteId || !animator) {
    return;
  }

  const response =
    await getVehicles(currentRouteId);

  vehicleCount.textContent =
    String(response.vehicleCount);

  feedTime.textContent =
    formatTimestamp(
      response.feedTimestamp,
    );

  animator.update(response.vehicles);

  const ageSeconds =
    response.feedTimestamp
      ? Math.max(
          0,
          Math.round(
            Date.now() / 1000 -
              response.feedTimestamp,
          ),
        )
      : null;

  setStatus(
    `${
      ageSeconds === null
        ? "Feed conectado"
        : `En directo · hace ${ageSeconds} s`
    } · ${response.rejectedVehicleCount} posiciones descartadas`,
    "live",
  );
}

function updateRouteCard(
  route: TransitRoute,
  data: ActiveRouteResponse,
) {
  routeCard.classList.remove("hidden");

  routeBadge.textContent =
    route.shortName;

  routeBadge.style.background =
    asHex(route.color);

  routeBadge.style.color =
    asHex(route.textColor);

  routeName.textContent =
    route.longName ||
    `Línea ${route.shortName}`;

  routeMeta.textContent =
    `${route.liveCount} buses válidos · ` +
    `${data.stopCount} paradas · ` +
    `${data.activeShapeCount} recorridos activos`;

  stopCount.textContent =
    String(data.stopCount);
}

async function selectRoute(
  route: TransitRoute,
) {
  currentRouteId = route.routeId;

  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
  }

  animator?.clear();

  const data =
    await getActiveRoute(route.routeId);

  currentRoute = data;

  getSource("active-route").setData(
    data.shapes,
  );

  getSource("active-stops").setData(
    data.stops,
  );

  map.setPaintProperty(
    "route-main",
    "line-color",
    asHex(route.color),
  );

  installBusImage(route);

  updateRouteCard(route, data);

  await refreshVehicles();
  fitCurrentRoute();

  pollTimer = window.setInterval(
    () => {
      void refreshVehicles().catch(
        (error) => {
          console.error(error);

          setStatus(
            error instanceof Error
              ? error.message
              : String(error),
            "error",
          );
        },
      );
    },
    5_000,
  );
}

async function loadRoutes() {
  setStatus("Cargando Bizkaibus…");

  const response = await getRoutes();

  routeSelect.innerHTML = "";

  for (const route of response.routes) {
    const option =
      document.createElement("option");

    option.value = route.routeId;

    option.textContent =
      `${route.shortName}` +
      `${
        route.longName
          ? ` · ${route.longName}`
          : ""
      } · ${route.liveCount} buses`;

    routeSelect.appendChild(option);
  }

  if (response.routes.length === 0) {
    routeSelect.innerHTML =
      `<option value="">Sin líneas activas</option>`;

    setStatus(
      "No hay líneas activas válidas.",
      "error",
    );

    return;
  }

  const defaultRoute =
    [...response.routes].sort(
      (a, b) =>
        b.liveCount - a.liveCount,
    )[0];

  routeSelect.value =
    defaultRoute.routeId;

  await selectRoute(defaultRoute);

  routeSelect.addEventListener(
    "change",
    () => {
      const selected =
        response.routes.find(
          (route) =>
            route.routeId ===
            routeSelect.value,
        );

      if (!selected) return;

      void selectRoute(selected).catch(
        (error) => {
          console.error(error);

          setStatus(
            error instanceof Error
              ? error.message
              : String(error),
            "error",
          );
        },
      );
    },
  );
}

fitRouteButton.addEventListener(
  "click",
  fitCurrentRoute,
);

map.on("load", () => {
  add3DBuildings();
  ensureLayers();
  registerMapInteractions();

  animator = new VehicleAnimator(
    getSource("live-buses"),
  );

  animator.start();

  void loadRoutes().catch(
    (error) => {
      console.error(error);

      setStatus(
        error instanceof Error
          ? error.message
          : String(error),
        "error",
      );
    },
  );
});

window.addEventListener(
  "beforeunload",
  () => {
    if (pollTimer !== null) {
      window.clearInterval(pollTimer);
    }

    animator?.stop();
  },
);


