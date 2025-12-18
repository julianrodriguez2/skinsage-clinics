import { Router } from "express";
import { AuthenticatedRequest, requireAuth, requireRole } from "../middleware/auth";
import { getScan, listScans, updateScanStatus } from "../store";
import { scanStatusSchema } from "../validators";

const router = Router();

router.use(requireAuth());

router.get("/", (req, res) => {
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
  const data = listScans(patientId);
  res.json({ data });
});

router.get("/:id", (req, res) => {
  const scan = getScan(req.params.id);
  if (!scan) return res.status(404).json({ error: "Scan not found" });
  const auth = req as AuthenticatedRequest;
  if (auth.user?.role === "patient" && auth.user.patientId !== scan.patientId) {
    return res.status(403).json({ error: "Forbidden: patient mismatch" });
  }
  requireRole(["admin", "clinician", "staff", "patient"])(req, res, () => {});
  if (res.headersSent) return;
  res.json({ data: scan });
});

router.patch("/:id", (req, res) => {
  requireRole(["admin", "clinician", "staff"])(req, res, () => {});
  if (res.headersSent) return;
  const parsed = scanStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const updated = updateScanStatus(req.params.id, parsed.data);
  if (!updated) return res.status(404).json({ error: "Scan not found" });
  res.json({ data: updated });
});

export default router;
