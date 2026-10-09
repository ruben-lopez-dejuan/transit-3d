import './loadEnvironment';
import compression from 'compression';
import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";

import {
  getActiveRouteData,
  getActiveRoutes,
  getBizkaibusSnapshot,
} from "./providers/bizkaibus/service";
import { getCityNetwork, isCityNetworkInitialized } from './transit/network';
import { cityRegistry, defaultCityId, cityPackageReports } from './cities';
import { CACHE_CONTROL, cacheControl, networkCacheControl } from './httpCache';
import { buildCityDiagnostics, cityIndex, isAdminAuthorized } from './admin/diagnostics';

const app = express();

const port = Number(process.env.PORT || 3001);
const distDirectory = path.resolve("dist");

app.disable("x-powered-by");
app.set('etag', 'strong');
app.use(compression({ threshold: 1024 }));
app.use(express.json({ limit: "32kb" }));
app.use('/api', cacheControl(CACHE_CONTROL.live));
app.use('/api/admin', (request, response, next) => {
  const configuredToken = process.env.TRANSIT_ADMIN_TOKEN?.trim();
  const header = request.headers['x-admin-token'];
  const suppliedToken = typeof header === 'string' ? header : undefined;
  if (!isAdminAuthorized(configuredToken, suppliedToken)) {
    response.status(401).json({ error: 'Token de administración no válido.' });
    return;
  }
  next();
});
app.get('/api/admin/cities', (_request, response) => {
  response.json(cityRegistry.getCities().flatMap((manifest) => {
    const city = cityRegistry.getCity(manifest.id);
    return city ? [cityIndex(city, isCityNetworkInitialized(manifest.id))] : [];
  }));
});
app.get('/api/admin/cities/:cityId', async (request, response) => {
  const cityId = String(request.params.cityId);
  const city = cityRegistry.getCity(cityId);
  if (!city) { response.status(404).json({ error: 'Ciudad no registrada.' }); return; }
  try {
    const runtime = getCityNetwork(cityId);
    const [network, snapshot] = await Promise.all([runtime.getNetwork(), runtime.getPresentationSnapshot()]);
    response.json(buildCityDiagnostics(city, network, snapshot, runtime.getCatalogDiagnostics()));
  } catch (error) {
    console.warn(`[admin:${cityId}] Diagnostics unavailable:`, error instanceof Error ? error.message : error);
    response.status(503).json({ error: 'No se pudo generar el diagnóstico de la ciudad.' });
  }
});
app.use('/api', (request, response, next) => {
  const cityId = typeof request.query.cityId === 'string' ? request.query.cityId : defaultCityId;
  if (!cityRegistry.getCity(cityId)) { response.status(404).json({ error: 'Ciudad no registrada.' }); return; }
  response.locals.cityId = cityId;
  response.locals.transit = getCityNetwork(cityId);
  next();
});
app.get('/api/cities', cacheControl(CACHE_CONTROL.manifest), (_request, response) => response.json(cityRegistry.getCities()));
app.get('/api/cities/default', cacheControl(CACHE_CONTROL.manifest), (_request, response) => response.json(cityRegistry.getCity(defaultCityId)!.manifest));
app.get('/api/city-packages', (_request, response) => response.json(cityPackageReports));
app.get('/api/cities/:cityId', cacheControl(CACHE_CONTROL.manifest), (request, response) => {
  const city = cityRegistry.getCity(String(request.params.cityId));
  if (!city) { response.status(404).json({ error: 'Ciudad no registrada.' }); return; }
  response.json(city.manifest);
});
app.get('/api/providers/health', (_request, response) => response.json(cityRegistry.getProvidersForCity(response.locals.cityId).map((p) => ({ id: p.operatorId, enabled: p.enabled, capabilities: p.definition.capabilities, health: cityRegistry.getProviderHealth(response.locals.cityId, p.operatorId) }))));

app.use(
  cors({
    origin: true,
    credentials: false,
  }),
);

// Liveness never waits for an external operator. Provider health remains
// available separately and can degrade without restarting the whole service.
app.get('/api/health', (_request, response) => response.json({
  ok: true,
  service: 'transit-3d',
  uptimeSeconds: Math.round(process.uptime()),
  cities: cityRegistry.getCities().length,
}));

app.get("/api/routes", async (_request, response) => {
  try {
    const [routes, snapshot] = await Promise.all([
      getActiveRoutes(),
      getBizkaibusSnapshot(),
    ]);

    response.json({
      feedTimestamp: snapshot.feedTimestamp,
      routes,
    });
  } catch (error) {
    response.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : String(error),
    });
  }
});

app.get(
  "/api/routes/:routeId/active",
  async (request, response) => {
    try {
      const data = await getActiveRouteData(
        request.params.routeId,
      );

      if (!data) {
        response.status(404).json({
          error: "Route not found",
        });
        return;
      }

      response.json(data);
    } catch (error) {
      response.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  },
);

app.get("/api/vehicles", async (request, response) => {
  try {
    const snapshot = await getBizkaibusSnapshot();

    const routeId =
      typeof request.query.routeId === "string"
        ? request.query.routeId
        : null;

    const vehicles = routeId
      ? snapshot.vehicles.filter(
          (vehicle) =>
            vehicle.routeId === routeId,
        )
      : snapshot.vehicles;

    response.json({
      feedTimestamp: snapshot.feedTimestamp,
      fetchedAtMs: snapshot.fetchedAtMs,
      vehicleCount: vehicles.length,
      totalValidVehicleCount:
        snapshot.validVehicleCount,
      rawVehicleCount: snapshot.rawVehicleCount,
      rejectedVehicleCount:
        snapshot.rejectedVehicleCount,
      unmatchedTripCount:
        snapshot.unmatchedTripCount,
      vehicles,
    });
  } catch (error) {
    response.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : String(error),
    });
  }
});

app.get("/api/transit", async (_request, response) => {
  try {
    const snapshot = await (response.locals.transit as ReturnType<typeof getCityNetwork>).getPresentationSnapshot();
    response.json({ ...snapshot, serverTime: Date.now() });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/network", async (_request, response) => {
  try {
    const network = await (response.locals.transit as ReturnType<typeof getCityNetwork>).getNetwork();
    response.setHeader('Cache-Control', networkCacheControl(network.operators));
    response.json(network);
  }
  catch { response.status(503).json({ error: "No se ha podido cargar la red de transporte." }); }
});
app.get("/api/lines/:operatorId/:routeId", async (request, response) => {
  try {
    const detail = await (response.locals.transit as ReturnType<typeof getCityNetwork>).getLine(request.params.operatorId, request.params.routeId, typeof request.query.direction === 'string' ? request.query.direction : undefined);
    if (!detail) { response.status(404).json({ error: "Línea no disponible." }); return; }
    response.json(detail);
  } catch { response.status(503).json({ error: "No se pudo cargar la línea. Inténtalo de nuevo." }); }
});
app.get("/api/stops/:operatorId/:stopId", async (request, response) => {
  try {
    const detail = await (response.locals.transit as ReturnType<typeof getCityNetwork>).getStop(request.params.operatorId, request.params.stopId);
    if (!detail) { response.status(404).json({ error: "Parada no disponible." }); return; }
    response.json(detail);
  } catch { response.status(503).json({ error: "No se pudieron cargar las próximas llegadas." }); }
});
app.get("/api/trips/:operatorId/:tripId", async (request, response) => {
  try {
    const detail = await (response.locals.transit as ReturnType<typeof getCityNetwork>).getTrip(request.params.operatorId, request.params.tripId, String(request.query.date ?? ''), request.query.vehicleId ? String(request.query.vehicleId) : undefined);
    if (!detail) { response.status(404).json({ error: "Viaje no disponible." }); return; }
    response.json(detail);
  } catch { response.status(503).json({ error: "No se pudo cargar el viaje." }); }
});
app.post("/api/geometries", async (request, response) => {
  if (!Array.isArray(request.body?.keys) || request.body.keys.length > 100 || request.body.keys.some((key: unknown) => typeof key !== "string" || key.length > 300)) { response.status(400).json({ error: "Solicitud de geometrías no válida." }); return; }
  try { response.json(await (response.locals.transit as ReturnType<typeof getCityNetwork>).getGeometries(request.body.keys)); }
  catch { response.status(503).json({ error: "Recorridos no disponibles temporalmente." }); }
});

if (fs.existsSync(distDirectory)) {
  app.use('/assets', express.static(path.join(distDirectory, 'assets'), {
    maxAge: '1y',
    immutable: true,
  }));
  app.use(
    express.static(distDirectory, {
      extensions: ["html"],
      setHeaders: (response) => response.setHeader('Cache-Control', CACHE_CONTROL.shell),
    }),
  );

  app.get("/{*splat}", (request, response, next) => {
    if (request.path.startsWith("/api/")) {
      next();
      return;
    }

    response.sendFile(
      path.join(distDirectory, "index.html"),
    );
  });
}

app.listen(port, () => {
  console.log("");
  console.log(
    `Transit 3D API → http://localhost:${port}`,
  );

  if (fs.existsSync(distDirectory)) {
    console.log(
      `Web app → http://localhost:${port}`,
    );
  } else {
    console.log(
      "Development frontend → http://localhost:5173",
    );
  }

  const warmCityId = process.env.TRANSIT_WARM_CITY;
  if (warmCityId && cityRegistry.getCity(warmCityId)) {
    void getCityNetwork(warmCityId).getNetwork().catch((error) => {
      console.warn(`[warmup] ${warmCityId}:`, error instanceof Error ? error.message : error);
    });
  }

  console.log("");
});
