import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";

import {
  getActiveRouteData,
  getActiveRoutes,
  getBizkaibusSnapshot,
} from "./providers/bizkaibus/service";
import { BizkaibusProvider } from "./providers/bizkaibus/provider";
import { TransitEngine } from "./transit/engine";

const transitEngine = new TransitEngine([new BizkaibusProvider()]);

const app = express();

const port = Number(process.env.PORT || 3001);
const distDirectory = path.resolve("dist");

app.disable("x-powered-by");

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
    response.json(await transitEngine.getSnapshot());
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
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
