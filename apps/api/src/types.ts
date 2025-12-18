export type Role = "admin" | "clinician" | "staff" | "patient";

export type ScanAngle = "front" | "left" | "right" | "left45" | "right45";

export interface Patient {
  id: string;
  clinicId: string;
  name: string;
  email?: string;
  phone?: string;
  consentVersion: string;
  status: "active" | "inactive";
  createdAt: string;
  joinedAt?: string;
}

export interface ScanImage {
  id: string;
  scanId: string;
  angle: ScanAngle;
  url?: string;
  blurScore?: number;
  lightScore?: number;
  poseOk?: boolean;
  checksum?: string;
}

export interface Scan {
  id: string;
  patientId: string;
  capturedAt: string;
  status: "pending" | "processing" | "complete" | "rejected";
  qualityFlags: string[];
  images: ScanImage[];
  missingAngles: ScanAngle[];
  ingestJobId?: string;
  notes?: string;
}
