import { Router } from "express";
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

router.get("/", (req, res) => {
  const status =
    req.query.status === "inactive" || req.query.status === "active"
      ? (req.query.status as "inactive" | "active")
      : undefined;
  const patients = listPatients({ status }).map((patient) => ({
    ...patient,
    needsScan: patientNeedsScan(patient.id)
  }));
  res.json({ data: patients });
});

router.post("/", (req, res) => {
  const parsed = patientCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const patient = createPatient(parsed.data);
  res.status(201).json({ data: patient });
});

router.post("/join", (req, res) => {
  const parsed = patientJoinSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const patient = upsertPatientFromClinicCode(parsed.data);
  res.status(201).json({ data: patient });
});

router.get("/:id", (req, res) => {
  const patient = getPatient(req.params.id);
  if (!patient) return res.status(404).json({ error: "Patient not found" });
  res.json({ data: { ...patient, needsScan: patientNeedsScan(patient.id) } });
});

router.get("/:id/scans", (req, res) => {
  const patient = getPatient(req.params.id);
  if (!patient) return res.status(404).json({ error: "Patient not found" });
  const scans = listScans(patient.id);
  res.json({ data: scans });
});

router.post("/:id/scans", (req, res) => {
  const patient = getPatient(req.params.id);
  if (!patient) return res.status(404).json({ error: "Patient not found" });

  const parsed = scanCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const scan = createScan({
    patientId: patient.id,
    capturedAt: parsed.data.capturedAt,
    angles: parsed.data.angles
  });

  res.status(201).json({ data: scan });
});

export default router;
