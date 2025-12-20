import { Camera, CameraType } from "expo-camera";
import * as Crypto from "expo-crypto";
import * as FaceDetector from "expo-face-detector";
import * as FileSystem from "expo-file-system";
import { StatusBar } from "expo-status-bar";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

const ANGLES = [
  { key: "front", label: "Front", yaw: { min: -10, max: 10 } },
  { key: "left45", label: "45 deg Left", yaw: { min: -40, max: -15 } },
  { key: "left", label: "Left", yaw: { min: -65, max: -35 } },
  { key: "right45", label: "45 deg Right", yaw: { min: 15, max: 40 } },
  { key: "right", label: "Right", yaw: { min: 35, max: 65 } },
] as const;

type AngleKey = (typeof ANGLES)[number]["key"];

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

function yawInRange(angle: AngleKey, yaw: number) {
  const range = ANGLES.find((item) => item.key === angle)?.yaw;
  if (!range) return false;
  return yaw >= range.min && yaw <= range.max;
}

async function digestFile(uri: string) {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
}

async function evaluateCapture(
  uri: string,
  angle: AngleKey
): Promise<CaptureQuality> {
  const faces = await FaceDetector.detectFacesAsync(uri, {
    mode: FaceDetector.FaceDetectorMode.fast,
    detectLandmarks: FaceDetector.FaceDetectorLandmarks.none,
    runClassifications: FaceDetector.FaceDetectorClassifications.none,
  });

  const face = faces.faces[0];
  const yaw = face?.yawAngle ?? null;
  const poseOk = yaw !== null ? yawInRange(angle, yaw) : false;

  const fileInfo = await FileSystem.getInfoAsync(uri, { size: true });
  const size = fileInfo.size ?? 0;
  // Placeholder until native pixel analysis is wired
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
    yaw,
  };
}

async function apiPost<T>(
  path: string,
  token: string,
  body?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  const json = (await res.json()) as { data: T };
  return json.data;
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
        headers: { "Content-Type": contentType },
      });
      if (res.status >= 200 && res.status < 300) return;
    } catch (err) {
      if (i === attempts - 1) throw err;
    }
    await delay(500 * (i + 1));
  }
  throw new Error("Upload failed");
}

export default function App() {
  const cameraRef = useRef<Camera | null>(null);
  const [permission, requestPermission] = Camera.useCameraPermissions();
  const [captureMode, setCaptureMode] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [captures, setCaptures] = useState<Record<AngleKey, CaptureItem>>({});
  const [preview, setPreview] = useState<CaptureItem | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [liveYaw, setLiveYaw] = useState<number | null>(null);
  const [apiToken, setApiToken] = useState("");
  const [patientId, setPatientId] = useState("");
  const [uploadState, setUploadState] = useState<UploadState>({
    status: "idle",
  });

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
        skipProcessing: true,
      });
      const quality = await evaluateCapture(photo.uri, currentAngle.key);
      const capture: CaptureItem = {
        uri: photo.uri,
        angle: currentAngle.key,
        contentType: "image/jpeg",
        quality,
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
      const checksum = await digestFile(preview.uri);
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
    if (!apiToken || !patientId) {
      setUploadState({
        status: "error",
        message: "Set API token and patient ID.",
      });
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
        checksum: captures[angle.key]?.checksum,
      }));
      const scan = await apiPost<{ id: string }>(
        `/patients/${patientId}/scans`,
        apiToken,
        { angles: anglesPayload }
      );

      setUploadState({
        status: "uploading",
        message: "Requesting upload URLs...",
      });
      const uploadUrls = await apiPost<
        {
          angle: AngleKey;
          uploadUrl: string;
          storageKey: string;
          url: string;
        }[]
      >(`/scans/${scan.id}/upload-urls`, apiToken, {
        angles: ANGLES.map((angle) => ({
          angle: angle.key,
          checksum: captures[angle.key]?.checksum,
          contentType: captures[angle.key]?.contentType ?? "image/jpeg",
        })),
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
          total: ANGLES.length,
        });
        await uploadWithRetry(
          capture.uri,
          upload.uploadUrl,
          capture.contentType
        );
        completed += 1;
      }

      setUploadState({ status: "uploading", message: "Verifying scan..." });
      await apiPost(`/scans/${scan.id}/ingest`, apiToken, {});
      setUploadState({ status: "done", message: "Upload complete." });
    } catch (err) {
      setUploadState({
        status: "error",
        message: err instanceof Error ? err.message : "Upload failed.",
      });
    }
  };

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
            runClassifications: FaceDetector.FaceDetectorClassifications.none,
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
            <View
              style={[styles.dot, livePoseOk ? styles.dotOk : styles.dotWarn]}
            />
            <Text style={styles.small}>
              {liveYaw === null ? "Face not detected" : "Pose aligned"}
            </Text>
          </View>
          {preview ? (
            <View style={styles.previewCard}>
              <Image
                source={{ uri: preview.uri }}
                style={styles.previewImage}
              />
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
                <TouchableOpacity
                  style={styles.btnSecondary}
                  onPress={handleRetake}
                >
                  <Text style={styles.btnTextDark}>Retake</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.btn,
                    !(
                      preview.quality.faceDetected &&
                      preview.quality.poseOk &&
                      preview.quality.blurOk &&
                      preview.quality.lightOk
                    ) && styles.btnDisabled,
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
              <TouchableOpacity
                style={styles.btnSecondary}
                onPress={() => setCaptureMode(false)}
              >
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
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>SkinSage Clinical</Text>
        <Text style={styles.sub}>Remote skin tracking - patient app</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>API Settings</Text>
          <Text style={styles.body}>Paste a patient token and patient ID.</Text>
          <TextInput
            style={styles.input}
            placeholder="API token"
            placeholderTextColor="#64748b"
            value={apiToken}
            onChangeText={setApiToken}
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            placeholder="Patient ID"
            placeholderTextColor="#64748b"
            value={patientId}
            onChangeText={setPatientId}
            autoCapitalize="none"
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Capture progress</Text>
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
            Uses signed URLs, retries failed uploads, and triggers server
            checks.
          </Text>
          <TouchableOpacity
            style={[styles.btn, !allCaptured && styles.btnDisabled]}
            onPress={handleUpload}
            disabled={!allCaptured || uploadState.status === "uploading"}
          >
            <Text style={styles.btnText}>
              {uploadState.status === "uploading"
                ? "Uploading..."
                : "Upload scans"}
            </Text>
          </TouchableOpacity>
          {uploadState.message ? (
            <Text style={styles.small}>{uploadState.message}</Text>
          ) : null}
          {uploadState.completed !== undefined && uploadState.total ? (
            <Text style={styles.small}>
              {uploadState.completed}/{uploadState.total} uploaded
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#0b1220",
  },
  container: {
    padding: 20,
    gap: 14,
  },
  title: {
    color: "#e2e8f0",
    fontSize: 28,
    fontWeight: "700",
  },
  sub: {
    color: "#94a3b8",
    marginBottom: 8,
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  cardTitle: {
    color: "#e2e8f0",
    fontSize: 18,
    fontWeight: "700",
  },
  body: {
    color: "#cbd5e1",
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pill: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 999,
  },
  pillText: {
    color: "#e2e8f0",
    fontWeight: "600",
  },
  list: {
    gap: 6,
  },
  btn: {
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#2fd2a1",
    alignItems: "center",
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnText: {
    color: "#0b1220",
    textAlign: "center",
    fontWeight: "700",
  },
  btnSecondary: {
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "rgba(47, 210, 161, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(47, 210, 161, 0.5)",
    paddingHorizontal: 16,
  },
  btnTextDark: {
    color: "#2fd2a1",
    textAlign: "center",
    fontWeight: "700",
  },
  small: {
    color: "#94a3b8",
    fontSize: 13,
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    paddingVertical: 10,
    paddingHorizontal: 12,
    color: "#e2e8f0",
  },
  cameraScreen: {
    flex: 1,
    backgroundColor: "#0b1220",
  },
  camera: {
    flex: 1,
  },
  cameraOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    padding: 20,
    justifyContent: "space-between",
  },
  cameraHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cameraTitle: {
    color: "#e2e8f0",
    fontSize: 20,
    fontWeight: "700",
  },
  guide: {
    alignSelf: "center",
    width: 240,
    height: 320,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.6)",
  },
  captureControls: {
    alignItems: "center",
    gap: 12,
  },
  captureBtn: {
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 999,
    backgroundColor: "#2fd2a1",
  },
  qualityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  dotOk: {
    backgroundColor: "#2fd2a1",
  },
  dotWarn: {
    backgroundColor: "#ffb340",
  },
  previewCard: {
    backgroundColor: "rgba(11, 18, 32, 0.9)",
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },
  previewImage: {
    width: "100%",
    height: 240,
    borderRadius: 12,
  },
});
