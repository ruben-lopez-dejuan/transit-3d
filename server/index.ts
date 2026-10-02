import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";

import {
  getActiveRouteData,
  getActiveRoutes,
  getBizkaibusSnapshot,
} from "./providers/bizkaibus/service";
import { getNetwork, getPresentationSnapshot, getLine, getStop, getTrip, getGeometries } from "./transit/network";

const app = express();

const port = Number(process.env.PORT || 3001);
const distDirectory = path.resolve("dist");

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use("/api", (_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });

app.use(
  cors({
    origin: true,
    credentials: false,
  }),
);

app.get("/api/health", async (_request, response) => {
  try {
    const snapshot = await getBizkaibusSnapshot();

    response.json({
      ok: true,
      provider: "bizkaibus",
      feedTimestamp: snapshot.feedTimestamp,
      rawVehicleCount: snapshot.rawVehicleCount,
      validVehicleCount: snapshot.validVehicleCount,
      rejectedVehicleCount: snapshot.rejectedVehicleCount,
      unmatchedTripCount: snapshot.unmatchedTripCount,
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : String(error),
    });
  }
});

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
    const snapshot = await getPresentationSnapshot();
    response.json({ ...snapshot, serverTime: Date.now() });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/network", async (_request, response) => {
  try { response.json(await getNetwork()); }
  catch { response.status(503).json({ error: "No se ha podido cargar la red de transporte." }); }
});
app.get("/api/lines/:operatorId/:routeId", async (request, response) => {
  try {
    const detail = await getLine(request.params.operatorId, request.params.routeId, typeof request.query.direction === "string" ? request.query.direction : undefined);
    if (!detail) { response.status(404).json({ error: "Línea no disponible." }); return; }
    response.json(detail);
  } catch { response.status(503).json({ error: "No se pudo cargar la línea. Inténtalo de nuevo." }); }
});
app.get("/api/stops/:operatorId/:stopId", async (request, response) => {
  try {
    const detail = await getStop(request.params.operatorId, request.params.stopId);
    if (!detail) { response.status(404).json({ error: "Parada no disponible." }); return; }
    response.json(detail);
  } catch { response.status(503).json({ error: "No se pudieron cargar las próximas llegadas." }); }
});
app.get("/api/trips/:operatorId/:tripId", async (request, response) => {
  try {
    const detail = await getTrip(request.params.operatorId, request.params.tripId, String(request.query.date ?? ""), request.query.vehicleId ? String(request.query.vehicleId) : undefined);
    if (!detail) { response.status(404).json({ error: "Viaje no disponible." }); return; }
    response.json(detail);
  } catch { response.status(503).json({ error: "No se pudo cargar el viaje." }); }
});
app.post("/api/geometries", async (request, response) => {
  if (!Array.isArray(request.body?.keys) || request.body.keys.length > 100 || request.body.keys.some((key: unknown) => typeof key !== "string" || key.length > 300)) { response.status(400).json({ error: "Solicitud de geometrías no válida." }); return; }
  try { response.json(await getGeometries(request.body.keys)); }
  catch { response.status(503).json({ error: "Recorridos no disponibles temporalmente." }); }
});

if (fs.existsSync(distDirectory)) {
  app.use(
    express.static(distDirectory, {
      extensions: ["html"],
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
    `Bilbao Transit 3D API → http://localhost:${port}`,
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

  console.log("");
});
