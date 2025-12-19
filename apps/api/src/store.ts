import { Prisma, ScanAngle, ScanStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { REQUIRED_ANGLES } from "./validators";

export async function createPatient(data: {
  clinicId: string;
  name: string;
  email?: string;
  phone?: string;
  consentVersion: string;
  status: "active" | "inactive";
  joinedAt?: string;
  userId?: string;
}) {
  return prisma.patient.create({
    data: {
      clinicId: data.clinicId,
      name: data.name,
      email: data.email,
      phone: data.phone,
      consentVersion: data.consentVersion,
      status: data.status === "inactive" ? "inactive" : "active",
      joinedAt: data.joinedAt ? new Date(data.joinedAt) : new Date(),
      userId: data.userId
    }
  });
}

export async function upsertPatientFromClinicCode(input: {
  clinicCode: string;
  name: string;
  email?: string;
  phone?: string;
  consentVersion: string;
}) {
  const clinic = await prisma.clinic.findUnique({ where: { code: input.clinicCode } });
  if (!clinic) {
    throw new Error("Invalid clinic code");
  }
  return createPatient({
    clinicId: clinic.id,
    name: input.name,
    email: input.email,
    phone: input.phone,
    consentVersion: input.consentVersion,
    status: "active",
    joinedAt: new Date().toISOString()
  });
}

export async function listPatients(filter?: { status?: "active" | "inactive" }) {
  return prisma.patient.findMany({
    where: {
      status: filter?.status
    },
    orderBy: { createdAt: "desc" }
  });
}

export async function getPatient(id: string) {
  return prisma.patient.findUnique({ where: { id } });
}

export async function createScan(input: {
  patientId: string;
  capturedAt?: string;
  angles: { angle: ScanAngle; checksum?: string }[];
}) {
  const existingAngles = new Set<ScanAngle>();
  const images = input.angles.map((angle) => {
    existingAngles.add(angle.angle);
    return {
      angle: angle.angle,
      checksum: angle.checksum
    };
  });

  const missingAngles = REQUIRED_ANGLES.filter((angle) => !existingAngles.has(angle));

  return prisma.scan.create({
    data: {
      patientId: input.patientId,
      capturedAt: input.capturedAt ? new Date(input.capturedAt) : new Date(),
      status: "processing",
      qualityFlags: [],
      missingAngles,
      images: {
        create: images
      }
    },
    include: {
      images: true
    }
  });
}

export async function listScans(patientId?: string) {
  return prisma.scan.findMany({
    where: patientId ? { patientId } : undefined,
    include: { images: true },
    orderBy: { capturedAt: "desc" }
  });
}

export async function getScan(id: string) {
  return prisma.scan.findUnique({ where: { id }, include: { images: true } });
}

export async function updateScanStatus(
  id: string,
  payload: Partial<Pick<Prisma.ScanUpdateInput, "status" | "qualityFlags" | "notes">>
) {
  return prisma.scan.update({
    where: { id },
    data: {
      status: payload.status as ScanStatus | undefined,
      qualityFlags: payload.qualityFlags as string[] | undefined,
      notes: payload.notes as string | undefined
    },
    include: { images: true }
  });
}

export async function patientNeedsScan(patientId: string, thresholdDays = 30) {
  const latest = await prisma.scan.findFirst({
    where: { patientId },
    orderBy: { capturedAt: "desc" },
    select: { capturedAt: true }
  });
  if (!latest) return true;
  const diffDays = (Date.now() - latest.capturedAt.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays > thresholdDays;
}
