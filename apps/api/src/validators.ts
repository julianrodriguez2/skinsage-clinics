import { z } from "zod";
import { ScanAngle } from "./types";

export const REQUIRED_ANGLES: ScanAngle[] = [
  "front",
  "left",
  "right",
  "left45",
  "right45"
];

export const loginSchema = z.object({
  identifier: z.string().min(3, "Email or phone required"),
  code: z.string().min(4, "Code/OTP required")
});

export const patientCreateSchema = z.object({
  clinicId: z.string(),
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  consentVersion: z.string().default("v1"),
  status: z.enum(["active", "inactive"]).default("active")
});

export const patientJoinSchema = z.object({
  clinicCode: z.string().min(4),
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  consentVersion: z.string().default("v1")
});

export const scanCreateSchema = z.object({
  capturedAt: z.string().datetime().optional(),
  angles: z
    .array(
      z.object({
        angle: z.custom<ScanAngle>(),
        checksum: z.string().optional()
      })
    )
    .nonempty()
});

export const scanStatusSchema = z.object({
  status: z.enum(["pending", "processing", "complete", "rejected"]),
  qualityFlags: z.array(z.string()).optional(),
  notes: z.string().optional()
});
