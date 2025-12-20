import { Router } from "express";
import { AuthenticatedRequest, requireAuth, requireRole } from "../middleware/auth";
import { createUploadUrls, ingestScanMedia } from "../media";
import { getScan, listScans, updateScanStatus } from "../store";
import { scanStatusSchema, scanUploadSchema } from "../validators";

const router = Router();

router.use(requireAuth());

router.get("/", async (req, res) => {
  const patientId = typeof req.query.patientId === "string" ? req.query.patientId : undefined;
  const auth = req as AuthenticatedRequest;
  if (auth.user?.role === "patient") {
    if (!auth.user.patientId || auth.user.patientId !== patientId) {
      return res.status(403).json({ error: "Forbidden: patient mismatch" });
    }
  } else {
    requireRole(["admin", "clinician", "staff"])(req, res, () => {});
    if (res.headersSent) return;
  }
  const data = await listScans(patientId);
  res.json({ data });
});

router.post("/:id/upload-urls", async (req, res) => {
  const auth = req as AuthenticatedRequest;
  if (auth.user?.role === "patient") {
    const scan = await getScan(req.params.id);
    if (!scan) {
      return res.status(404).json({ error: "Scan not found" });
    }
    if (scan.patientId !== auth.user.patientId) {
      return res.status(403).json({ error: "Forbidden: patient mismatch" });
    }
  } else {
    requireRole(["admin", "clinician", "staff"])(req, res, () => {});
    if (res.headersSent) return;
  }

  const parsed = scanUploadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    const results = await createUploadUrls(req.params.id, parsed.data.angles);
    res.json({ data: results });
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

router.post("/:id/ingest", async (req, res) => {
  const auth = req as AuthenticatedRequest;
  if (auth.user?.role === "patient") {
    const scan = await getScan(req.params.id);
    if (!scan) {
      return res.status(404).json({ error: "Scan not found" });
    }
    if (scan.patientId !== auth.user.patientId) {
      return res.status(403).json({ error: "Forbidden: patient mismatch" });
    }
  } else {
    requireRole(["admin", "clinician", "staff"])(req, res, () => {});
    if (res.headersSent) return;
  }

  try {
    const updated = await ingestScanMedia(req.params.id);
    res.json({ data: updated });
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

router.get("/:id", async (req, res) => {
  const scan = await getScan(req.params.id);
  if (!scan) return res.status(404).json({ error: "Scan not found" });
  const auth = req as AuthenticatedRequest;
  if (auth.user?.role === "patient" && auth.user.patientId !== scan.patientId) {
    return res.status(403).json({ error: "Forbidden: patient mismatch" });
  }
  requireRole(["admin", "clinician", "staff", "patient"])(req, res, () => {});
  if (res.headersSent) return;
  res.json({ data: scan });
});

router.patch("/:id", async (req, res) => {
  requireRole(["admin", "clinician", "staff"])(req, res, () => {});
  if (res.headersSent) return;
  const parsed = scanStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  try {
    const updated = await updateScanStatus(req.params.id, parsed.data);
    if (!updated) return res.status(404).json({ error: "Scan not found" });
    res.json({ data: updated });
  } catch (err) {
    res.status(404).json({ error: "Scan not found" });
  }
});

export default router;
