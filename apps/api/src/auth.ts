import jwt from "jsonwebtoken";
import { nanoid } from "nanoid";
import { createPatient } from "./store";
import { Role } from "./types";

const ACCESS_TOKEN_TTL = Number(
  process.env.ACCESS_TOKEN_TTL_SECONDS ?? 15 * 60
); // 15m
const REFRESH_TOKEN_TTL = Number(
  process.env.REFRESH_TOKEN_TTL_SECONDS ?? 7 * 24 * 60 * 60
); // 7d
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || JWT_SECRET;

type UserRecord = {
  id: string;
  identifier: string;
  role: Role;
  patientId?: string;
};

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

// Seed demo users
const demoPatient = createPatient({
  clinicId: "demo-clinic",
  name: "Demo Patient",
  email: "demo-patient@skinsage.com",
  consentVersion: "v1",
  status: "active",
  joinedAt: new Date().toISOString(),
  phone: undefined,
});

const users = new Map<string, UserRecord>([
  [
    "demo-clinician@skinsage.com",
    {
      id: "user-1",
      identifier: "demo-clinician@skinsage.com",
      role: "clinician",
    },
  ],
  [
    "demo-patient@skinsage.com",
    {
      id: "user-2",
      identifier: "demo-patient@skinsage.com",
      role: "patient",
      patientId: demoPatient.id,
    },
  ],
]);

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

export function findUserByIdentifier(
  identifier: string
): UserRecord | undefined {
  return users.get(identifier);
}

export function issueOtp(identifier: string) {
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

export function issueTokens(user: UserRecord) {
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

    const user: UserRecord = {
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
  } catch {}
}

// expose the OTP for automated tests (not for production use).
export function __getOtpForTesting(identifier: string): string | undefined {
  return otpStore.get(identifier)?.code;
}
