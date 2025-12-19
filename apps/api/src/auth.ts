import jwt from "jsonwebtoken";
import { nanoid } from "nanoid";
import { Role } from "@prisma/client";
import { prisma } from "./prisma";

const ACCESS_TOKEN_TTL = Number(
  process.env.ACCESS_TOKEN_TTL_SECONDS ?? 15 * 60
); // 15m
const REFRESH_TOKEN_TTL = Number(
  process.env.REFRESH_TOKEN_TTL_SECONDS ?? 7 * 24 * 60 * 60
); // 7d
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || JWT_SECRET;

type RefreshSession = {
  tokenId: string;
  userId: string;
  role: Role;
  patientId?: string;
  expiresAt: number;
  active: boolean;
};

type OtpEntry = {
  code: string;
  expiresAt: number;
};

const otpStore = new Map<string, OtpEntry>();
const refreshStore = new Map<string, RefreshSession>();

let demoSeedPromise: Promise<void> | null = null;

async function seedDemo() {
  const clinic = await prisma.clinic.upsert({
    where: { code: "SKIN-001" },
    update: {},
    create: { id: "demo-clinic", name: "Demo Clinic", code: "SKIN-001" },
  });

  const clinician = await prisma.user.upsert({
    where: { identifier: "demo-clinician@skinsage.com" },
    update: {},
    create: { identifier: "demo-clinician@skinsage.com", role: "clinician" },
  });

  const patientUser = await prisma.user.upsert({
    where: { identifier: "demo-patient@skinsage.com" },
    update: {},
    create: { identifier: "demo-patient@skinsage.com", role: "patient" },
  });

  await prisma.clinicMember.upsert({
    where: { userId_clinicId: { userId: clinician.id, clinicId: clinic.id } },
    update: {},
    create: { userId: clinician.id, clinicId: clinic.id, role: "clinician" },
  });

  await prisma.patient.upsert({
    where: { userId: patientUser.id },
    update: {},
    create: {
      clinicId: clinic.id,
      userId: patientUser.id,
      name: "Demo Patient",
      consentVersion: "v1",
      status: "active",
      joinedAt: new Date(),
    },
  });
}

async function ensureDemoSeed() {
  if (!demoSeedPromise) {
    demoSeedPromise = seedDemo();
  }
  return demoSeedPromise;
}

type AccessClaims = {
  sub: string;
  role: Role;
  patientId?: string;
  jti: string;
  type: "access";
};

type RefreshClaims = {
  sub: string;
  role: Role;
  patientId?: string;
  jti: string;
  type: "refresh";
};

export type AuthContext = {
  userId: string;
  role: Role;
  patientId?: string;
  tokenId: string;
};

export async function findUserByIdentifier(identifier: string) {
  await ensureDemoSeed();
  const user = await prisma.user.findUnique({
    where: { identifier },
    include: { patient: { select: { id: true } } },
  });
  if (!user) return undefined;
  return {
    id: user.id,
    identifier: user.identifier,
    role: user.role,
    patientId: user.patient?.id,
  };
}

export async function issueOtp(identifier: string) {
  await ensureDemoSeed();
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + 5 * 60 * 1000;
  otpStore.set(identifier, { code, expiresAt });
  return { expiresAt };
}

export function verifyOtp(identifier: string, code: string): boolean {
  const entry = otpStore.get(identifier);
  if (!entry) return false;
  const isValid = entry.code === code && entry.expiresAt > Date.now();
  if (isValid) otpStore.delete(identifier);
  return isValid;
}

export function issueTokens(user: {
  id: string;
  role: Role;
  patientId?: string;
}) {
  const accessId = nanoid();
  const refreshId = nanoid();

  const accessToken = jwt.sign(
    {
      sub: user.id,
      role: user.role,
      patientId: user.patientId,
      jti: accessId,
      type: "access",
    } satisfies AccessClaims,
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );

  const refreshToken = jwt.sign(
    {
      sub: user.id,
      role: user.role,
      patientId: user.patientId,
      jti: refreshId,
      type: "refresh",
    } satisfies RefreshClaims,
    REFRESH_SECRET,
    { expiresIn: REFRESH_TOKEN_TTL }
  );

  refreshStore.set(refreshId, {
    tokenId: refreshId,
    userId: user.id,
    role: user.role,
    patientId: user.patientId,
    expiresAt: Date.now() + REFRESH_TOKEN_TTL * 1000,
    active: true,
  });

  return { accessToken, refreshToken };
}

export function verifyAccessToken(token: string): AuthContext | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AccessClaims;
    if (decoded.type !== "access") return null;
    return {
      userId: decoded.sub,
      role: decoded.role,
      patientId: decoded.patientId,
      tokenId: decoded.jti,
    };
  } catch {
    return null;
  }
}

export function rotateRefreshToken(token: string) {
  try {
    const decoded = jwt.verify(token, REFRESH_SECRET) as RefreshClaims;
    if (decoded.type !== "refresh") return null;
    const session = refreshStore.get(decoded.jti);
    if (
      !session ||
      !session.active ||
      session.expiresAt < Date.now() ||
      session.userId !== decoded.sub
    ) {
      return null;
    }

    // revoke old
    session.active = false;
    refreshStore.set(decoded.jti, session);

    const user = {
      id: decoded.sub,
      identifier: "",
      role: decoded.role,
      patientId: decoded.patientId,
    };
    return issueTokens(user);
  } catch {
    return null;
  }
}

export function invalidateRefresh(token: string) {
  try {
    const decoded = jwt.verify(token, REFRESH_SECRET) as RefreshClaims;
    const session = refreshStore.get(decoded.jti);
    if (session) {
      session.active = false;
      refreshStore.set(decoded.jti, session);
    }
  } catch {
    // ignore
  }
}

// expose the OTP for automated tests (not for production use).
export function __getOtpForTesting(identifier: string): string | undefined {
  return otpStore.get(identifier)?.code;
}
