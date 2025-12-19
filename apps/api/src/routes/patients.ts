import { Router } from "express";
import { AuthenticatedRequest, requireAuth, requireRole } from "../middleware/auth";
import {
  createPatient,
  getPatient,
  listPatients,
  patientNeedsScan,
  upsertPatientFromClinicCode,
  createScan,
  listScans
} from "../store";
import {
  patientCreateSchema,
  patientJoinSchema,
  scanCreateSchema
} from "../validators";

const router = Router();

router.use(requireAuth());

router.get("/", requireRole(["admin", "clinician", "staff"]), async (req, res) => {
  const status =
    req.query.status === "inactive" || req.query.status === "active"
      ? (req.query.status as "inactive" | "active")
      : undefined;
  const patients = await listPatients({ status });
  const withCompliance = await Promise.all(
    patients.map(async (patient) => ({
      ...patient,
      needsScan: await patientNeedsScan(patient.id)
    }))
  );
  res.json({ data: withCompliance });
});

router.post("/", requireRole(["admin", "clinician", "staff"]), async (req, res) => {
  const parsed = patientCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const patient = await createPatient(parsed.data);
  res.status(201).json({ data: patient });
});

router.post("/join", requireRole(["patient"]), async (req, res) => {
  const parsed = patientJoinSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  try {
    const patient = await upsertPatientFromClinicCode(parsed.data);
    res.status(201).json({ data: patient });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get(
  "/:id",
  requireRole(["admin", "clinician", "staff", "patient"]),
  async (req, res) => {
    const auth = req as AuthenticatedRequest;
    if (auth.user?.role === "patient" && auth.user.patientId !== req.params.id) {
      return res.status(403).json({ error: "Forbidden: patient mismatch" });
    }
    const patient = await getPatient(req.params.id);
    if (!patient) return res.status(404).json({ error: "Patient not found" });
    res.json({
      data: { ...patient, needsScan: await patientNeedsScan(patient.id) }
    });
  }
);

router.get(
  "/:id/scans",
  requireRole(["admin", "clinician", "staff", "patient"]),
  async (req, res) => {
    const auth = req as AuthenticatedRequest;
    if (auth.user?.role === "patient" && auth.user.patientId !== req.params.id) {
      return res.status(403).json({ error: "Forbidden: patient mismatch" });
    }
    const patient = await getPatient(req.params.id);
    if (!patient) return res.status(404).json({ error: "Patient not found" });
    const scans = await listScans(patient.id);
    res.json({ data: scans });
  }
);

router.post(
  "/:id/scans",
  requireRole(["admin", "clinician", "staff", "patient"]),
  async (req, res) => {
    const auth = req as AuthenticatedRequest;
    if (auth.user?.role === "patient" && auth.user.patientId !== req.params.id) {
      return res.status(403).json({ error: "Forbidden: patient mismatch" });
    }
    const patient = await getPatient(req.params.id);
    if (!patient) return res.status(404).json({ error: "Patient not found" });

    const parsed = scanCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const scan = await createScan({
      patientId: patient.id,
      capturedAt: parsed.data.capturedAt,
      angles: parsed.data.angles
    });

    res.status(201).json({ data: scan });
  }
);

export default router;
