import { Camera, CameraType } from "expo-camera";
import { BarCodeScanner } from "expo-barcode-scanner";
import * as Crypto from "expo-crypto";
import * as FaceDetector from "expo-face-detector";
import * as FileSystem from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

const SECURE_KEYS = {
  token: "skinsage_token",
  refresh: "skinsage_refresh",
  patientId: "skinsage_patient_id",
  clinicCode: "skinsage_clinic_code",
  clinicLinked: "skinsage_clinic_linked",
  consent: "skinsage_consent",
  identifier: "skinsage_identifier",
  role: "skinsage_role"
};

const ANGLES = [
  { key: "front", label: "Front", yaw: { min: -10, max: 10 } },
  { key: "left45", label: "45 deg Left", yaw: { min: -40, max: -15 } },
  { key: "left", label: "Left", yaw: { min: -65, max: -35 } },
  { key: "right45", label: "45 deg Right", yaw: { min: 15, max: 40 } },
  { key: "right", label: "Right", yaw: { min: 35, max: 65 } }
] as const;

type AngleKey = (typeof ANGLES)[number]["key"];
type TabKey = "timeline" | "capture" | "compare" | "appointments" | "settings";

type CaptureQuality = {
  faceDetected: boolean;
  poseOk: boolean;
  blurOk: boolean;
  lightOk: boolean;
  blurScore: number;
  lightScore: number;
  yaw: number | null;
};

type CaptureItem = {
  uri: string;
  angle: AngleKey;
  checksum?: string;
  contentType: string;
  quality: CaptureQuality;
};

type UploadState = {
  status: "idle" | "uploading" | "done" | "error";
  message?: string;
  completed?: number;
  total?: number;
};

type AuthState = {
  token: string | null;
  refresh: string | null;
  patientId: string | null;
  clinicCode: string | null;
  clinicLinked: boolean;
  consentAccepted: boolean;
  identifier: string | null;
  role: string | null;
};

type ScanImage = {
  id: string;
  angle: string;
  url?: string | null;
  blurScore?: number | null;
  lightScore?: number | null;
  poseOk?: boolean | null;
  checksum?: string | null;
};

type Scan = {
  id: string;
  capturedAt: string;
  status: "pending" | "processing" | "complete" | "rejected";
  qualityFlags: string[];
  missingAngles: string[];
  images: ScanImage[];
};

const initialAuth: AuthState = {
  token: null,
  refresh: null,
  patientId: null,
  clinicCode: null,
  clinicLinked: false,
  consentAccepted: false,
  identifier: null,
  role: null
};

function yawInRange(angle: AngleKey, yaw: number) {
  const range = ANGLES.find((item) => item.key === angle)?.yaw;
  if (!range) return false;
  return yaw >= range.min && yaw <= range.max;
}

function parseClinicCode(data: string) {
  const value = data.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    const code = url.searchParams.get("code");
    return code ?? value;
  } catch {
    return value;
  }
}

async function setSecureItem(key: string, value: string | null) {
  if (!value) {
    await SecureStore.deleteItemAsync(key);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function loadAuthState(): Promise<AuthState> {
  const [
    token,
    refresh,
    patientId,
    clinicCode,
    clinicLinked,
    consent,
    identifier,
    role
  ] = await Promise.all([
    SecureStore.getItemAsync(SECURE_KEYS.token),
    SecureStore.getItemAsync(SECURE_KEYS.refresh),
    SecureStore.getItemAsync(SECURE_KEYS.patientId),
    SecureStore.getItemAsync(SECURE_KEYS.clinicCode),
    SecureStore.getItemAsync(SECURE_KEYS.clinicLinked),
    SecureStore.getItemAsync(SECURE_KEYS.consent),
    SecureStore.getItemAsync(SECURE_KEYS.identifier),
    SecureStore.getItemAsync(SECURE_KEYS.role)
  ]);

  return {
    token: token ?? null,
    refresh: refresh ?? null,
    patientId: patientId ?? null,
    clinicCode: clinicCode ?? null,
    clinicLinked: clinicLinked === "true",
    consentAccepted: consent === "true",
    identifier: identifier ?? null,
    role: role ?? null
  };
}

async function persistAuthState(state: AuthState) {
  await Promise.all([
    setSecureItem(SECURE_KEYS.token, state.token),
    setSecureItem(SECURE_KEYS.refresh, state.refresh),
    setSecureItem(SECURE_KEYS.patientId, state.patientId),
    setSecureItem(SECURE_KEYS.clinicCode, state.clinicCode),
    setSecureItem(SECURE_KEYS.clinicLinked, state.clinicLinked ? "true" : null),
    setSecureItem(SECURE_KEYS.consent, state.consentAccepted ? "true" : null),
    setSecureItem(SECURE_KEYS.identifier, state.identifier),
    setSecureItem(SECURE_KEYS.role, state.role)
  ]);
}

async function digestFileBase64(uri: string) {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64
  });
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64, {
    encoding: Crypto.CryptoEncoding.HEX
  });
}

async function evaluateCapture(uri: string, angle: AngleKey): Promise<CaptureQuality> {
  const faces = await FaceDetector.detectFacesAsync(uri, {
    mode: FaceDetector.FaceDetectorMode.fast,
    detectLandmarks: FaceDetector.FaceDetectorLandmarks.none,
    runClassifications: FaceDetector.FaceDetectorClassifications.none
  });

  const face = faces.faces[0];
  const yaw = face?.yawAngle ?? null;
  const poseOk = yaw !== null ? yawInRange(angle, yaw) : false;

  const fileInfo = await FileSystem.getInfoAsync(uri, { size: true });
  const size = fileInfo.size ?? 0;
  const blurScore = Math.min(1, size / 250000);
  const lightScore = Math.min(1, size / 180000);
  const blurOk = blurScore >= 0.35;
  const lightOk = lightScore >= 0.35;

  return {
    faceDetected: Boolean(face),
    poseOk,
    blurOk,
    lightOk,
    blurScore,
    lightScore,
    yaw
  };
}

async function apiGet<T>(path: string, token: string | null): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  const json = (await res.json()) as { data: T };
  return json.data;
}

async function apiPost<T>(
  path: string,
  token: string | null,
  body?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  const json = (await res.json()) as { data?: T; token?: string; refreshToken?: string };
  return (json.data ?? (json as unknown)) as T;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function uploadWithRetry(
  uri: string,
  uploadUrl: string,
  contentType: string,
  attempts = 3
) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await FileSystem.uploadAsync(uploadUrl, uri, {
        httpMethod: "PUT",
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: { "Content-Type": contentType }
      });
      if (res.status >= 200 && res.status < 300) return;
    } catch (err) {
      if (i === attempts - 1) throw err;
    }
    await delay(500 * (i + 1));
  }
  throw new Error("Upload failed");
}

function formatDate(value: string) {
  const date = new Date(value);
  return date.toLocaleDateString();
}

export default function App() {
  const cameraRef = useRef<Camera | null>(null);
  const authRef = useRef<AuthState>(initialAuth);

  const [permission, requestPermission] = Camera.useCameraPermissions();
  const [auth, setAuth] = useState<AuthState>(initialAuth);
  const [hydrating, setHydrating] = useState(true);
  const [captureMode, setCaptureMode] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [captures, setCaptures] = useState<Record<AngleKey, CaptureItem>>({});
  const [preview, setPreview] = useState<CaptureItem | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [liveYaw, setLiveYaw] = useState<number | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>({
    status: "idle"
  });

  const [identifier, setIdentifier] = useState(auth.identifier ?? "");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [clinicCode, setClinicCode] = useState(auth.clinicCode ?? "");
  const [patientName, setPatientName] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scannerPermission, setScannerPermission] = useState<boolean | null>(null);

  const [activeTab, setActiveTab] = useState<TabKey>("timeline");
  const [scans, setScans] = useState<Scan[]>([]);
  const [scansLoading, setScansLoading] = useState(false);
  const [scansError, setScansError] = useState<string | null>(null);

  const [compareLeft, setCompareLeft] = useState<Scan | null>(null);
  const [compareRight, setCompareRight] = useState<Scan | null>(null);

  useEffect(() => {
    loadAuthState()
      .then((stored) => {
        authRef.current = stored;
        setAuth(stored);
        setIdentifier(stored.identifier ?? "");
        setClinicCode(stored.clinicCode ?? "");
      })
      .finally(() => setHydrating(false));
  }, []);

  useEffect(() => {
    authRef.current = auth;
  }, [auth]);

  const updateAuth = async (patch: Partial<AuthState>) => {
    const next = { ...authRef.current, ...patch };
    authRef.current = next;
    setAuth(next);
    await persistAuthState(next);
  };

  const refreshScans = useCallback(async () => {
    if (!authRef.current.token || !authRef.current.patientId) return;
    setScansLoading(true);
    setScansError(null);
    try {
      const data = await apiGet<Scan[]>(
        `/patients/${authRef.current.patientId}/scans`,
        authRef.current.token
      );
      setScans(data);
    } catch (err) {
      setScansError(err instanceof Error ? err.message : "Failed to load scans.");
    } finally {
      setScansLoading(false);
    }
  }, []);

  useEffect(() => {
    if (auth.token && auth.patientId) {
      refreshScans();
    }
  }, [auth.token, auth.patientId, refreshScans]);

  const isAuthed = Boolean(auth.token);
  const clinicReady = auth.clinicLinked;
  const consentReady = auth.consentAccepted;

  const currentAngle = ANGLES[currentIndex];
  const allCaptured = ANGLES.every((angle) => captures[angle.key]);

  const livePoseOk = useMemo(() => {
    if (liveYaw === null) return false;
    return yawInRange(currentAngle.key, liveYaw);
  }, [currentAngle.key, liveYaw]);

  const handleFacesDetected = useCallback(
    (result: { faces: Array<{ yawAngle?: number | null }> }) => {
      const face = result.faces?.[0];
      if (!face) {
        setLiveYaw(null);
        return;
      }
      setLiveYaw(face.yawAngle ?? null);
    },
    []
  );

  const startCapture = async () => {
    if (!permission?.granted) {
      await requestPermission();
      return;
    }
    setCaptureMode(true);
  };

  const handleTakePhoto = async () => {
    if (!cameraRef.current || captureBusy) return;
    setCaptureBusy(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        skipProcessing: true
      });
      const quality = await evaluateCapture(photo.uri, currentAngle.key);
      const capture: CaptureItem = {
        uri: photo.uri,
        angle: currentAngle.key,
        contentType: "image/jpeg",
        quality
      };
      setPreview(capture);
    } finally {
      setCaptureBusy(false);
    }
  };

  const handleAcceptPhoto = async () => {
    if (!preview) return;
    setCaptureBusy(true);
    try {
      const checksum = await digestFileBase64(preview.uri);
      const stored = { ...preview, checksum };
      setCaptures((prev) => ({ ...prev, [preview.angle]: stored }));
      setPreview(null);
      setLiveYaw(null);
      if (currentIndex < ANGLES.length - 1) {
        setCurrentIndex((idx) => idx + 1);
      }
    } finally {
      setCaptureBusy(false);
    }
  };

  const handleRetake = () => {
    setPreview(null);
  };

  const handleUpload = async () => {
    if (!auth.token || !auth.patientId) {
      setUploadState({ status: "error", message: "Missing auth or patient ID." });
      return;
    }
    if (!allCaptured) {
      setUploadState({ status: "error", message: "Capture all angles first." });
      return;
    }

    try {
      setUploadState({ status: "uploading", message: "Creating scan..." });
      const anglesPayload = ANGLES.map((angle) => ({
        angle: angle.key,
        checksum: captures[angle.key]?.checksum
      }));
      const scan = await apiPost<{ id: string }>(
        `/patients/${auth.patientId}/scans`,
        auth.token,
        { angles: anglesPayload }
      );

      setUploadState({ status: "uploading", message: "Requesting upload URLs..." });
      const uploadUrls = await apiPost<
        { angle: AngleKey; uploadUrl: string; storageKey: string; url: string }[]
      >(`/scans/${scan.id}/upload-urls`, auth.token, {
        angles: ANGLES.map((angle) => ({
          angle: angle.key,
          checksum: captures[angle.key]?.checksum,
          contentType: captures[angle.key]?.contentType ?? "image/jpeg"
        }))
      });

      const urlsByAngle = new Map(uploadUrls.map((item) => [item.angle, item]));
      let completed = 0;
      for (const angle of ANGLES) {
        const capture = captures[angle.key];
        const upload = urlsByAngle.get(angle.key);
        if (!capture || !upload) continue;
        setUploadState({
          status: "uploading",
          message: `Uploading ${angle.label}...`,
          completed,
          total: ANGLES.length
        });
        await uploadWithRetry(capture.uri, upload.uploadUrl, capture.contentType);
        completed += 1;
      }

      setUploadState({ status: "uploading", message: "Verifying scan..." });
      await apiPost(`/scans/${scan.id}/ingest`, auth.token, {});
      setUploadState({ status: "done", message: "Upload complete." });
      setCaptures({});
      setCurrentIndex(0);
      refreshScans();
    } catch (err) {
      setUploadState({
        status: "error",
        message: err instanceof Error ? err.message : "Upload failed."
      });
    }
  };

  const handleSendOtp = async () => {
    setAuthError(null);
    try {
      await apiPost("/auth/otp/send", null, { identifier });
      setOtpSent(true);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "OTP failed.");
    }
  };

  const handleVerifyOtp = async () => {
    setAuthError(null);
    try {
      const response = await apiPost<{
        token: string;
        refreshToken: string;
        user: { id: string; role: string; patientId?: string };
      }>("/auth/login", null, { identifier, code: otpCode });
      await updateAuth({
        token: response.token,
        refresh: response.refreshToken,
        patientId: response.user.patientId ?? auth.patientId,
        identifier,
        role: response.user.role
      });
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Login failed.");
    }
  };

  const handleJoinClinic = async () => {
    setJoinError(null);
    const parsed = parseClinicCode(clinicCode);
    if (!parsed) {
      setJoinError("Enter a clinic code.");
      return;
    }
    if (!patientName.trim()) {
      setJoinError("Enter your full name.");
      return;
    }
    if (auth.role && auth.role !== "patient") {
      setJoinError("Clinic join is only available for patient accounts.");
      return;
    }
    try {
      const patient = await apiPost<{ id: string; clinicId: string }>(
        "/patients/join",
        auth.token,
        {
          clinicCode: parsed,
          name: patientName.trim(),
          consentVersion: "v1"
        }
      );
      await updateAuth({
        patientId: patient.id,
        clinicCode: parsed,
        clinicLinked: true
      });
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "Join failed.");
    }
  };

  const handleScanQr = async () => {
    const permissionResult = await BarCodeScanner.requestPermissionsAsync();
    setScannerPermission(permissionResult.status === "granted");
    if (permissionResult.status === "granted") {
      setScanning(true);
    }
  };

  const handleQrScanned = ({ data }: { data: string }) => {
    const code = parseClinicCode(data);
    if (code) {
      setClinicCode(code);
      setScanning(false);
    }
  };

  const handleConsent = async () => {
    await updateAuth({ consentAccepted: true });
  };

  const handleLogout = async () => {
    const cleared = { ...initialAuth };
    authRef.current = cleared;
    setAuth(cleared);
    await persistAuthState(cleared);
    setIdentifier("");
    setOtpCode("");
    setOtpSent(false);
    setClinicCode("");
    setPatientName("");
    setCaptures({});
    setCurrentIndex(0);
    setUploadState({ status: "idle" });
    setActiveTab("timeline");
    setScans([]);
  };

  if (hydrating) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <View style={styles.center}>
          <ActivityIndicator color="#2fd2a1" />
          <Text style={styles.small}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!isAuthed) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.title}>SkinSage Clinical</Text>
          <Text style={styles.sub}>Secure OTP login</Text>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Sign in</Text>
            <TextInput
              style={styles.input}
              placeholder="Email or phone"
              placeholderTextColor="#64748b"
              value={identifier}
              onChangeText={setIdentifier}
              autoCapitalize="none"
            />
            {otpSent ? (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="One-time code"
                  placeholderTextColor="#64748b"
                  value={otpCode}
                  onChangeText={setOtpCode}
                  keyboardType="number-pad"
                />
                <TouchableOpacity style={styles.btn} onPress={handleVerifyOtp}>
                  <Text style={styles.btnText}>Verify code</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={styles.btn} onPress={handleSendOtp}>
                <Text style={styles.btnText}>Send OTP</Text>
              </TouchableOpacity>
            )}
            {authError ? <Text style={styles.errorText}>{authError}</Text> : null}
            <Text style={styles.small}>
              Demo: use demo-patient@skinsage.com and OTP from the API test endpoint.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!clinicReady) {
    if (scanning) {
      return (
        <View style={styles.cameraScreen}>
          <StatusBar style="light" />
          <BarCodeScanner onBarCodeScanned={handleQrScanned} style={styles.camera} />
          <View style={styles.cameraOverlay}>
            <Text style={styles.cameraTitle}>Scan clinic QR</Text>
            <TouchableOpacity style={styles.btnSecondary} onPress={() => setScanning(false)}>
              <Text style={styles.btnTextDark}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.title}>Connect to clinic</Text>
          <Text style={styles.sub}>Join with a code or QR.</Text>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Clinic code</Text>
            <TextInput
              style={styles.input}
              placeholder="Clinic code"
              placeholderTextColor="#64748b"
              value={clinicCode}
              onChangeText={setClinicCode}
              autoCapitalize="characters"
            />
            <TextInput
              style={styles.input}
              placeholder="Full name"
              placeholderTextColor="#64748b"
              value={patientName}
              onChangeText={setPatientName}
            />
            <TouchableOpacity style={styles.btn} onPress={handleJoinClinic}>
              <Text style={styles.btnText}>Join clinic</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnSecondary} onPress={handleScanQr}>
              <Text style={styles.btnTextDark}>Scan QR code</Text>
            </TouchableOpacity>
            {scannerPermission === false ? (
              <Text style={styles.errorText}>Camera permission is required.</Text>
            ) : null}
            {joinError ? <Text style={styles.errorText}>{joinError}</Text> : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!consentReady) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.title}>Consent</Text>
          <Text style={styles.sub}>Please review and accept.</Text>
          <View style={styles.card}>
            <Text style={styles.body}>
              You consent to secure storage of medical images and agree to the clinic
              privacy policy. Images are encrypted and used for longitudinal tracking.
            </Text>
            <TouchableOpacity style={styles.btn} onPress={handleConsent}>
              <Text style={styles.btnText}>I agree</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnSecondary} onPress={handleLogout}>
              <Text style={styles.btnTextDark}>Sign out</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (captureMode) {
    return (
      <View style={styles.cameraScreen}>
        <StatusBar style="light" />
        <Camera
          ref={cameraRef}
          style={styles.camera}
          type={CameraType.front}
          onFacesDetected={handleFacesDetected}
          faceDetectorSettings={{
            mode: FaceDetector.FaceDetectorMode.fast,
            detectLandmarks: FaceDetector.FaceDetectorLandmarks.none,
            runClassifications: FaceDetector.FaceDetectorClassifications.none
          }}
        />
        <View style={styles.cameraOverlay}>
          <View style={styles.cameraHeader}>
            <Text style={styles.cameraTitle}>{currentAngle.label}</Text>
            <Text style={styles.small}>
              {currentIndex + 1}/{ANGLES.length}
            </Text>
          </View>
          <View style={styles.guide} />
          <View style={styles.qualityRow}>
            <View style={[styles.dot, livePoseOk ? styles.dotOk : styles.dotWarn]} />
            <Text style={styles.small}>
              {liveYaw === null ? "Face not detected" : "Pose aligned"}
            </Text>
          </View>
          {preview ? (
            <View style={styles.previewCard}>
              <Image source={{ uri: preview.uri }} style={styles.previewImage} />
              <View style={styles.list}>
                <Text style={styles.small}>
                  Face: {preview.quality.faceDetected ? "ok" : "missing"}
                </Text>
                <Text style={styles.small}>
                  Pose: {preview.quality.poseOk ? "ok" : "out of range"}
                </Text>
                <Text style={styles.small}>
                  Blur: {preview.quality.blurOk ? "ok" : "soft"}
                </Text>
                <Text style={styles.small}>
                  Lighting: {preview.quality.lightOk ? "ok" : "low"}
                </Text>
              </View>
              <View style={styles.row}>
                <TouchableOpacity style={styles.btnSecondary} onPress={handleRetake}>
                  <Text style={styles.btnTextDark}>Retake</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.btn,
                    !(preview.quality.faceDetected &&
                      preview.quality.poseOk &&
                      preview.quality.blurOk &&
                      preview.quality.lightOk) && styles.btnDisabled
                  ]}
                  onPress={handleAcceptPhoto}
                  disabled={
                    !(
                      preview.quality.faceDetected &&
                      preview.quality.poseOk &&
                      preview.quality.blurOk &&
                      preview.quality.lightOk
                    )
                  }
                >
                  <Text style={styles.btnText}>Use photo</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.captureControls}>
              <TouchableOpacity
                style={[styles.captureBtn, !livePoseOk && styles.btnDisabled]}
                onPress={handleTakePhoto}
                disabled={captureBusy || (liveYaw !== null && !livePoseOk)}
              >
                {captureBusy ? (
                  <ActivityIndicator color="#0b1220" />
                ) : (
                  <Text style={styles.btnText}>Capture</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnSecondary} onPress={() => setCaptureMode(false)}>
                <Text style={styles.btnTextDark}>Exit</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.shell}>
        <View style={styles.shellHeader}>
          <View>
            <Text style={styles.title}>SkinSage Clinical</Text>
            <Text style={styles.sub}>Patient app</Text>
          </View>
          <View style={styles.pill}>
            <Text style={styles.pillText}>
              {auth.clinicCode ? `Clinic ${auth.clinicCode}` : "Clinic linked"}
            </Text>
          </View>
        </View>

        <View style={styles.shellContent}>
          {activeTab === "timeline" ? (
            <ScrollView contentContainerStyle={styles.listGap}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Scan timeline</Text>
                <Text style={styles.body}>Review scan sets and statuses.</Text>
                <View style={styles.row}>
                  <TouchableOpacity style={styles.btnSecondary} onPress={refreshScans}>
                    <Text style={styles.btnTextDark}>Refresh</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.btn} onPress={() => setActiveTab("capture")}>
                    <Text style={styles.btnText}>New scan</Text>
                  </TouchableOpacity>
                </View>
                {scansLoading ? <Text style={styles.small}>Loading...</Text> : null}
                {scansError ? <Text style={styles.errorText}>{scansError}</Text> : null}
                {scans.length ? (
                  scans.map((scan) => (
                    <View key={scan.id} style={styles.timelineRow}>
                      <View>
                        <Text style={styles.body}>{formatDate(scan.capturedAt)}</Text>
                        <Text style={styles.small}>
                          Status: {scan.status} | Missing angles:{" "}
                          {scan.missingAngles.length}
                        </Text>
                        {scan.qualityFlags.length ? (
                          <Text style={styles.small}>
                            Flags: {scan.qualityFlags.join(", ")}
                          </Text>
                        ) : null}
                      </View>
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>
                          {scan.status === "complete" ? "Complete" : "Pending"}
                        </Text>
                      </View>
                    </View>
                  ))
                ) : (
                  <Text style={styles.small}>No scans yet.</Text>
                )}
              </View>
            </ScrollView>
          ) : null}

          {activeTab === "capture" ? (
            <ScrollView contentContainerStyle={styles.listGap}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Capture set</Text>
                <Text style={styles.body}>
                  Capture each required angle with guidance and quality checks.
                </Text>
                <View style={styles.row}>
                  {ANGLES.map((angle) => (
                    <View key={angle.key} style={styles.pill}>
                      <Text style={styles.pillText}>
                        {angle.label} {captures[angle.key] ? "done" : "pending"}
                      </Text>
                    </View>
                  ))}
                </View>
                <TouchableOpacity style={styles.btn} onPress={startCapture}>
                  <Text style={styles.btnText}>Open camera</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Upload scan set</Text>
                <Text style={styles.body}>
                  Uses signed URLs, retries failed uploads, and triggers server checks.
                </Text>
                <TouchableOpacity
                  style={[styles.btn, !allCaptured && styles.btnDisabled]}
                  onPress={handleUpload}
                  disabled={!allCaptured || uploadState.status === "uploading"}
                >
                  <Text style={styles.btnText}>
                    {uploadState.status === "uploading" ? "Uploading..." : "Upload scans"}
                  </Text>
                </TouchableOpacity>
                {uploadState.message ? <Text style={styles.small}>{uploadState.message}</Text> : null}
                {uploadState.completed !== undefined && uploadState.total ? (
                  <Text style={styles.small}>
                    {uploadState.completed}/{uploadState.total} uploaded
                  </Text>
                ) : null}
              </View>
            </ScrollView>
          ) : null}

          {activeTab === "compare" ? (
            <ScrollView contentContainerStyle={styles.listGap}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Comparison</Text>
                <Text style={styles.body}>
                  Select two scans and compare the front angle.
                </Text>
                <View style={styles.row}>
                  <TouchableOpacity
                    style={styles.btnSecondary}
                    onPress={() => {
                      setCompareLeft(null);
                      setCompareRight(null);
                    }}
                  >
                    <Text style={styles.btnTextDark}>Clear selection</Text>
                  </TouchableOpacity>
                </View>
                {scans.length ? (
                  scans.map((scan) => (
                    <View key={scan.id} style={styles.timelineRow}>
                      <View>
                        <Text style={styles.body}>{formatDate(scan.capturedAt)}</Text>
                        <Text style={styles.small}>Status: {scan.status}</Text>
                      </View>
                      <View style={styles.row}>
                        <TouchableOpacity
                          style={styles.btnSecondary}
                          onPress={() => setCompareLeft(scan)}
                        >
                          <Text style={styles.btnTextDark}>Set A</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.btnSecondary}
                          onPress={() => setCompareRight(scan)}
                        >
                          <Text style={styles.btnTextDark}>Set B</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))
                ) : (
                  <Text style={styles.small}>No scans available.</Text>
                )}
              </View>

              {compareLeft && compareRight ? (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Side by side</Text>
                  <View style={styles.compareRow}>
                    {[compareLeft, compareRight].map((scan) => {
                      const front = scan.images.find((img) => img.angle === "front");
                      return (
                        <View key={scan.id} style={styles.comparePanel}>
                          <Text style={styles.small}>{formatDate(scan.capturedAt)}</Text>
                          {front?.url ? (
                            <Image source={{ uri: front.url }} style={styles.compareImage} />
                          ) : (
                            <View style={styles.placeholder}>
                              <Text style={styles.small}>No image</Text>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                </View>
              ) : null}
            </ScrollView>
          ) : null}

          {activeTab === "appointments" ? (
            <ScrollView contentContainerStyle={styles.listGap}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Appointments</Text>
                <Text style={styles.body}>
                  Upcoming visits and preparation instructions will appear here.
                </Text>
                <View style={styles.placeholder}>
                  <Text style={styles.small}>No appointments scheduled.</Text>
                </View>
              </View>
            </ScrollView>
          ) : null}

          {activeTab === "settings" ? (
            <ScrollView contentContainerStyle={styles.listGap}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Profile</Text>
                <Text style={styles.body}>Identifier: {auth.identifier ?? "-"}</Text>
                <Text style={styles.body}>Role: {auth.role ?? "-"}</Text>
                <Text style={styles.body}>Patient ID: {auth.patientId ?? "-"}</Text>
                <Text style={styles.body}>Clinic code: {auth.clinicCode ?? "-"}</Text>
              </View>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Consent</Text>
                <Text style={styles.body}>
                  You can revoke consent and re-accept later.
                </Text>
                <TouchableOpacity
                  style={styles.btnSecondary}
                  onPress={() => updateAuth({ consentAccepted: false })}
                >
                  <Text style={styles.btnTextDark}>Revoke consent</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Account</Text>
                <TouchableOpacity style={styles.btnSecondary} onPress={handleLogout}>
                  <Text style={styles.btnTextDark}>Sign out</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          ) : null}
        </View>

        <View style={styles.tabBar}>
          {(
            [
              { key: "timeline", label: "Timeline" },
              { key: "capture", label: "Capture" },
              { key: "compare", label: "Compare" },
              { key: "appointments", label: "Appointments" },
              { key: "settings", label: "Settings" }
            ] as const
          ).map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tabItem, activeTab === tab.key && styles.tabItemActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text style={activeTab === tab.key ? styles.tabTextActive : styles.tabText}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#0b1220"
  },
  shell: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12
  },
  shellHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12
  },
  shellContent: {
    flex: 1
  },
  tabBar: {
    flexDirection: "row",
    gap: 6,
    paddingTop: 10
  },
  tabItem: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center"
  },
  tabItemActive: {
    backgroundColor: "#2fd2a1"
  },
  tabText: {
    color: "#9fb1c7",
    fontSize: 12
  },
  tabTextActive: {
    color: "#0b1220",
    fontSize: 12,
    fontWeight: "700"
  },
  container: {
    padding: 20,
    gap: 14
  },
  title: {
    color: "#e2e8f0",
    fontSize: 24,
    fontWeight: "700"
  },
  sub: {
    color: "#94a3b8",
    marginBottom: 8
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 10
  },
  cardTitle: {
    color: "#e2e8f0",
    fontSize: 18,
    fontWeight: "700"
  },
  body: {
    color: "#cbd5e1"
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  list: {
    gap: 6
  },
  listGap: {
    gap: 12,
    paddingBottom: 12
  },
  pill: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 999
  },
  pillText: {
    color: "#e2e8f0",
    fontWeight: "600",
    fontSize: 12
  },
  badge: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "rgba(47, 210, 161, 0.2)"
  },
  badgeText: {
    color: "#a2f4da",
    fontSize: 12
  },
  btn: {
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#2fd2a1",
    alignItems: "center"
  },
  btnDisabled: {
    opacity: 0.5
  },
  btnText: {
    color: "#0b1220",
    textAlign: "center",
    fontWeight: "700"
  },
  btnSecondary: {
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "rgba(47, 210, 161, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(47, 210, 161, 0.5)",
    paddingHorizontal: 16,
    alignItems: "center"
  },
  btnTextDark: {
    color: "#2fd2a1",
    textAlign: "center",
    fontWeight: "700"
  },
  small: {
    color: "#94a3b8",
    fontSize: 12
  },
  errorText: {
    color: "#ffb340"
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    paddingVertical: 10,
    paddingHorizontal: 12,
    color: "#e2e8f0"
  },
  cameraScreen: {
    flex: 1,
    backgroundColor: "#0b1220"
  },
  camera: {
    flex: 1
  },
  cameraOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    padding: 20,
    justifyContent: "space-between"
  },
  cameraHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  cameraTitle: {
    color: "#e2e8f0",
    fontSize: 20,
    fontWeight: "700"
  },
  guide: {
    alignSelf: "center",
    width: 240,
    height: 320,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.6)"
  },
  captureControls: {
    alignItems: "center",
    gap: 12
  },
  captureBtn: {
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 999,
    backgroundColor: "#2fd2a1"
  },
  qualityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 999
  },
  dotOk: {
    backgroundColor: "#2fd2a1"
  },
  dotWarn: {
    backgroundColor: "#ffb340"
  },
  previewCard: {
    backgroundColor: "rgba(11, 18, 32, 0.9)",
    borderRadius: 14,
    padding: 16,
    gap: 12
  },
  previewImage: {
    width: "100%",
    height: 240,
    borderRadius: 12
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12
  },
  timelineRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomColor: "rgba(255,255,255,0.08)",
    borderBottomWidth: 1
  },
  compareRow: {
    flexDirection: "row",
    gap: 12
  },
  comparePanel: {
    flex: 1,
    gap: 8
  },
  compareImage: {
    width: "100%",
    height: 220,
    borderRadius: 12
  },
  placeholder: {
    height: 220,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center"
  }
});
