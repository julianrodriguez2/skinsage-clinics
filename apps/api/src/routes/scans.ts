import { Router } from "express";
import { getScan, listScans, updateScanStatus } from "../store";
import { scanStatusSchema } from "../validators";

const router = Router();

router.get("/", (req, res) => {
  const patientId = typeof req.query.patientId === "string" ? req.query.patientId : undefined;
  const data = listScans(patientId);
  res.json({ data });
});

router.get("/:id", (req, res) => {
  const scan = getScan(req.params.id);
  if (!scan) return res.status(404).json({ error: "Scan not found" });
  res.json({ data: scan });
});

router.patch("/:id", (req, res) => {
  const parsed = scanStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const updated = updateScanStatus(req.params.id, parsed.data);
  if (!updated) return res.status(404).json({ error: "Scan not found" });
  res.json({ data: updated });
});

export default router;
