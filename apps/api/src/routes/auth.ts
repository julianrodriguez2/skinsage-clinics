import { Router } from "express";
import {
  __getOtpForTesting,
  findUserByIdentifier,
  invalidateRefresh,
  issueOtp,
  issueTokens,
  rotateRefreshToken,
  verifyOtp,
} from "../auth";
import { loginSchema } from "../validators";
import { z } from "zod";

const router = Router();

router.post("/login", (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { identifier, code } = parsed.data;
  const user = findUserByIdentifier(identifier);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  const valid = verifyOtp(identifier, code);
  if (!valid) {
    return res.status(401).json({ error: "Invalid or expired code" });
  }

  const tokens = issueTokens(user);

  res.json({
    token: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    user: { id: user.id, role: user.role, patientId: user.patientId },
  });
});

router.post("/otp/send", (req, res) => {
  const parsed = loginSchema.pick({ identifier: true }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const user = findUserByIdentifier(parsed.data.identifier);
  if (!user) return res.status(404).json({ error: "User not found" });
  const entry = issueOtp(parsed.data.identifier);
  res.json({ ok: true, expiresAt: entry.expiresAt });
});

router.post("/refresh", (req, res) => {
  const parsed = z
    .object({ refreshToken: z.string().min(10) })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const rotated = rotateRefreshToken(parsed.data.refreshToken);
  if (!rotated) {
    return res.status(401).json({ error: "Invalid refresh token" });
  }
  res.json({ token: rotated.accessToken, refreshToken: rotated.refreshToken });
});

router.post("/logout", (req, res) => {
  const parsed = z
    .object({ refreshToken: z.string().optional() })
    .safeParse(req.body);
  if (parsed.success && parsed.data.refreshToken) {
    invalidateRefresh(parsed.data.refreshToken);
  }
  res.json({ ok: true });
});

// tests only
router.get("/otp/testing/:identifier", (req, res) => {
  const code = __getOtpForTesting(req.params.identifier);
  if (!code) return res.status(404).json({ error: "OTP not found" });
  res.json({ code });
});

export default router;
