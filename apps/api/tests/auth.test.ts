import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";

const app = createApp();

async function loginWithOtp(identifier: string) {
  await request(app).post("/auth/otp/send").send({ identifier });
  const otpRes = await request(app).get(`/auth/otp/testing/${identifier}`);
  const code = otpRes.body.code as string;
  expect(code).toBeDefined();
  const res = await request(app).post("/auth/login").send({ identifier, code });
  expect(res.status).toBe(200);
  return res.body as { token: string; refreshToken: string };
}

describe("Auth and RBAC", () => {
  it("issues tokens after OTP login", async () => {
    const res = await loginWithOtp("demo-clinician@skinsage.com");
    expect(res.token).toBeTruthy();
    expect(res.refreshToken).toBeTruthy();
  });

  it("rejects unauthenticated access", async () => {
    const res = await request(app).get("/patients");
    expect(res.status).toBe(401);
  });

  it("enforces role restrictions for patients list", async () => {
    const patient = await loginWithOtp("demo-patient@skinsage.com");
    const res = await request(app)
      .get("/patients")
      .set("Authorization", `Bearer ${patient.token}`);
    expect(res.status).toBe(403);
  });

  it("allows clinician to list patients", async () => {
    const clinician = await loginWithOtp("demo-clinician@skinsage.com");
    const res = await request(app)
      .get("/patients")
      .set("Authorization", `Bearer ${clinician.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("rotates refresh tokens and invalidates the old one", async () => {
    const login = await loginWithOtp("demo-clinician@skinsage.com");
    const first = await request(app).post("/auth/refresh").send({ refreshToken: login.refreshToken });
    expect(first.status).toBe(200);
    const second = await request(app).post("/auth/refresh").send({ refreshToken: login.refreshToken });
    expect(second.status).toBe(401);
  });
});
