export const API_BASE =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export type Patient = {
  id: string;
  clinicId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  consentVersion: string;
  status: "active" | "inactive";
  createdAt: string;
  joinedAt?: string | null;
  needsScan?: boolean;
};

export type ScanImage = {
  id: string;
  scanId: string;
  angle: string;
  url?: string | null;
  blurScore?: number | null;
  lightScore?: number | null;
  poseOk?: boolean | null;
  checksum?: string | null;
  storageKey?: string | null;
  landmarks?: unknown;
};

export type Scan = {
  id: string;
  patientId: string;
  capturedAt: string;
  status: "pending" | "processing" | "complete" | "rejected";
  qualityFlags: string[];
  missingAngles: string[];
  ingestJobId?: string | null;
  notes?: string | null;
  images: ScanImage[];
};

type ApiResponse<T> = { data: T };

function getToken() {
  return localStorage.getItem("skinsage_token");
}

function buildHeaders(extra?: HeadersInit) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return { ...headers, ...extra };
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: buildHeaders()
  });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  const json = (await res.json()) as ApiResponse<T>;
  return json.data;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: buildHeaders(),
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || `Request failed: ${res.status}`);
  }
  const json = (await res.json()) as ApiResponse<T>;
  return json.data;
}

export async function requestOtp(identifier: string) {
  await fetch(`${API_BASE}/auth/otp/send`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({ identifier })
  });
}

export async function loginWithCode(identifier: string, code: string) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({ identifier, code })
  });
  if (!res.ok) {
    throw new Error(`Login failed: ${res.status}`);
  }
  const json = (await res.json()) as {
    token: string;
    refreshToken: string;
    user: { id: string; role: string; patientId?: string };
  };
  localStorage.setItem("skinsage_token", json.token);
  localStorage.setItem("skinsage_refresh", json.refreshToken);
  return json;
}

export async function loginWithTestOtp(identifier: string) {
  await requestOtp(identifier);
  const res = await fetch(`${API_BASE}/auth/otp/testing/${identifier}`, {
    headers: buildHeaders()
  });
  if (!res.ok) {
    throw new Error("Test OTP endpoint unavailable");
  }
  const { code } = (await res.json()) as { code: string };
  return loginWithCode(identifier, code);
}
