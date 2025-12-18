import { randomUUID } from "crypto";
import { Patient, Scan, ScanAngle, ScanImage } from "./types";
import { REQUIRED_ANGLES } from "./validators";

const patients = new Map<string, Patient>();
const scans = new Map<string, Scan>();

export const ClinicCodes: Record<string, string> = {
  "SKIN-001": "demo-clinic"
};

export function createPatient(data: Omit<Patient, "id" | "createdAt">): Patient {
  const id = randomUUID();
  const patient: Patient = {
    ...data,
    id,
    createdAt: new Date().toISOString()
  };
  patients.set(id, patient);
  return patient;
}

export function upsertPatientFromClinicCode(input: {
  clinicCode: string;
  name: string;
  email?: string;
  phone?: string;
  consentVersion: string;
}): Patient {
  const clinicId = ClinicCodes[input.clinicCode] ?? "unknown";
  return createPatient({
    clinicId,
    name: input.name,
    email: input.email,
    phone: input.phone,
    consentVersion: input.consentVersion,
    status: "active",
    joinedAt: new Date().toISOString()
  });
}

export function listPatients(filter?: { status?: Patient["status"] }): Patient[] {
  const all = Array.from(patients.values());
  if (!filter?.status) return all;
  return all.filter((p) => p.status === filter.status);
}

export function getPatient(id: string): Patient | undefined {
  return patients.get(id);
}

export function createScan(input: {
  patientId: string;
  capturedAt?: string;
  angles: { angle: ScanAngle; checksum?: string }[];
}): Scan {
  const existingAngles = new Set<ScanAngle>();
  const images: ScanImage[] = input.angles.map((angle) => {
    existingAngles.add(angle.angle);
    return {
      id: randomUUID(),
      scanId: "",
      angle: angle.angle,
      checksum: angle.checksum
    };
  });

  const missingAngles = REQUIRED_ANGLES.filter((angle) => !existingAngles.has(angle));
  const scanId = randomUUID();
  const scan: Scan = {
    id: scanId,
    patientId: input.patientId,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    status: "processing",
    qualityFlags: [],
    images: images.map((img) => ({ ...img, scanId })),
    missingAngles
  };

  scans.set(scanId, scan);
  return scan;
}

export function listScans(patientId?: string): Scan[] {
  const all = Array.from(scans.values());
  if (!patientId) return all;
  return all.filter((scan) => scan.patientId === patientId);
}

export function getScan(id: string): Scan | undefined {
  return scans.get(id);
}

export function updateScanStatus(
  id: string,
  payload: Partial<Pick<Scan, "status" | "qualityFlags" | "notes">>
): Scan | undefined {
  const existing = scans.get(id);
  if (!existing) return undefined;
  const updated: Scan = {
    ...existing,
    ...payload,
    qualityFlags: payload.qualityFlags ?? existing.qualityFlags
  };
  scans.set(id, updated);
  return updated;
}

export function patientNeedsScan(patientId: string, thresholdDays = 30): boolean {
  const patientScans = listScans(patientId).sort((a, b) =>
    a.capturedAt < b.capturedAt ? 1 : -1
  );
  if (!patientScans.length) return true;
  const last = new Date(patientScans[0].capturedAt).getTime();
  const now = Date.now();
  const diffDays = (now - last) / (1000 * 60 * 60 * 24);
  return diffDays > thresholdDays;
}
