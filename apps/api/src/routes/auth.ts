import { Router } from "express";
import { loginSchema } from "../validators";

const router = Router();

router.post("/login", (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { identifier } = parsed.data;
  const role = identifier.includes("@clinic") ? "clinician" : "patient";
  const token = `demo-${role}-${Date.now()}`;

  res.json({
    token,
    refreshToken: `${token}-refresh`,
    user: { id: "demo-user", role }
  });
});

router.post("/otp/send", (req, res) => {
  const parsed = loginSchema.pick({ identifier: true }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  res.json({ ok: true, message: "OTP dispatched (stub)" });
});

router.post("/refresh", (_req, res) => {
  const token = `demo-refresh-${Date.now()}`;
  res.json({ token });
});

export default router;
