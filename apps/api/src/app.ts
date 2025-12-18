import cors from "cors";
import express from "express";
import morgan from "morgan";
import authRouter from "./routes/auth";
import patientsRouter from "./routes/patients";
import scansRouter from "./routes/scans";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));
  app.use(morgan("dev"));

  app.get("/health", (_, res) => {
    res.json({ ok: true, service: "api", timestamp: new Date().toISOString() });
  });

  app.use("/auth", authRouter);
  app.use("/patients", patientsRouter);
  app.use("/scans", scansRouter);

  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      console.error(err);
      res.status(500).json({ error: "Internal error", message: err.message });
    }
  );

  return app;
}

export default createApp;
