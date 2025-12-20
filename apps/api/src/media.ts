import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash } from "crypto";
import sharp from "sharp";
import { prisma } from "./prisma";
import { REQUIRED_ANGLES } from "./validators";
import { ScanAngle } from "@prisma/client";

const S3_BUCKET = process.env.S3_BUCKET || "skinsage";
const S3_REGION = process.env.S3_REGION || "us-east-1";
const S3_ENDPOINT = process.env.S3_ENDPOINT;
const S3_PUBLIC_BASE_URL = process.env.S3_PUBLIC_BASE_URL;

const s3 = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT,
  forcePathStyle: Boolean(S3_ENDPOINT),
  credentials:
    process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
        }
      : undefined
});

type UploadAngleRequest = {
  angle: ScanAngle;
  contentType: string;
  checksum?: string;
};

type UploadUrlResult = {
  angle: ScanAngle;
  uploadUrl: string;
  storageKey: string;
  url: string;
};

type QualityResult = {
  blurScore: number;
  lightScore: number;
  poseOk: boolean;
  landmarks: {
    estimated: boolean;
    points: { name: string; x: number; y: number }[];
  };
};

const BLUR_THRESHOLD = Number(process.env.BLUR_THRESHOLD ?? 120);
const LIGHT_THRESHOLD = Number(process.env.LIGHT_THRESHOLD ?? 55);

function buildPublicUrl(key: string) {
  if (S3_PUBLIC_BASE_URL) {
    return `${S3_PUBLIC_BASE_URL.replace(/\/+$/, "")}/${key}`;
  }
  return `s3://${S3_BUCKET}/${key}`;
}

function extensionForContentType(type: string) {
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  return "jpg";
}

function keyForAngle(scanId: string, patientId: string, angle: ScanAngle, ext: string) {
  return `scans/${patientId}/${scanId}/${angle}.${ext}`;
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

async function analyzeImage(buffer: Buffer): Promise<QualityResult> {
  const { data, info } = await sharp(buffer)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;
  const size = width * height;

  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
  }
  const lightScore = sum / size;

  let laplacianSum = 0;
  let laplacianSqSum = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const center = data[idx];
      const up = data[idx - width];
      const down = data[idx + width];
      const left = data[idx - 1];
      const right = data[idx + 1];
      const lap = -4 * center + up + down + left + right;
      laplacianSum += lap;
      laplacianSqSum += lap * lap;
      count += 1;
    }
  }

  const mean = laplacianSum / Math.max(count, 1);
  const variance = laplacianSqSum / Math.max(count, 1) - mean * mean;
  const blurScore = variance;

  const landmarks = {
    estimated: true,
    points: [
      { name: "leftEye", x: width * 0.35, y: height * 0.4 },
      { name: "rightEye", x: width * 0.65, y: height * 0.4 },
      { name: "nose", x: width * 0.5, y: height * 0.55 },
      { name: "mouthLeft", x: width * 0.42, y: height * 0.7 },
      { name: "mouthRight", x: width * 0.58, y: height * 0.7 }
    ]
  };

  const poseOk = blurScore >= BLUR_THRESHOLD && lightScore >= LIGHT_THRESHOLD;

  return { blurScore, lightScore, poseOk, landmarks };
}

export async function createUploadUrls(
  scanId: string,
  items: UploadAngleRequest[]
): Promise<UploadUrlResult[]> {
  const scan = await prisma.scan.findUnique({
    where: { id: scanId }
  });
  if (!scan) {
    throw new Error("Scan not found");
  }

  const results: UploadUrlResult[] = [];
  for (const item of items) {
    const ext = extensionForContentType(item.contentType);
    const storageKey = keyForAngle(scan.id, scan.patientId, item.angle, ext);
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: storageKey,
        ContentType: item.contentType
      }),
      { expiresIn: 900 }
    );

    const url = buildPublicUrl(storageKey);

    await prisma.scanImage.upsert({
      where: { scanId_angle: { scanId: scan.id, angle: item.angle } },
      update: {
        storageKey,
        url,
        checksum: item.checksum
      },
      create: {
        scanId: scan.id,
        angle: item.angle,
        storageKey,
        url,
        checksum: item.checksum
      }
    });

    results.push({ angle: item.angle, uploadUrl, storageKey, url });
  }

  const storedAngles = await prisma.scanImage.findMany({
    where: { scanId: scan.id },
    select: { angle: true }
  });
  const anglesPresent = new Set(storedAngles.map((image) => image.angle));
  const missingAngles = REQUIRED_ANGLES.filter((angle) => !anglesPresent.has(angle));
  await prisma.scan.update({
    where: { id: scan.id },
    data: {
      missingAngles
    }
  });

  return results;
}

export async function ingestScanMedia(scanId: string) {
  const scan = await prisma.scan.findUnique({
    where: { id: scanId },
    include: { images: true }
  });
  if (!scan) {
    throw new Error("Scan not found");
  }

  const qualityFlags = new Set<string>();

  for (const image of scan.images) {
    if (!image.storageKey) {
      qualityFlags.add(`missing_storage:${image.angle}`);
      continue;
    }

    try {
      const object = await s3.send(
        new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: image.storageKey
        })
      );

      const body = object.Body as unknown;
      const hasStream =
        body && typeof (body as { pipe?: unknown }).pipe === "function";
      if (
        !body ||
        (!Buffer.isBuffer(body) && !hasStream && !(body instanceof Uint8Array))
      ) {
        qualityFlags.add(`missing_object:${image.angle}`);
        continue;
      }

      const buffer = Buffer.isBuffer(body)
        ? body
        : body instanceof Uint8Array
          ? Buffer.from(body)
          : await streamToBuffer(body as NodeJS.ReadableStream);
    const checksumRaw = createHash("sha256").update(buffer).digest("hex");
    const checksumBase64 = createHash("sha256")
      .update(buffer.toString("base64"))
      .digest("hex");

    if (
      image.checksum &&
      image.checksum !== checksumRaw &&
      image.checksum !== checksumBase64
    ) {
      qualityFlags.add(`checksum_mismatch:${image.angle}`);
    }

      const analysis = await analyzeImage(buffer);
      if (analysis.blurScore < BLUR_THRESHOLD) {
        qualityFlags.add(`blur:${image.angle}`);
      }
      if (analysis.lightScore < LIGHT_THRESHOLD) {
        qualityFlags.add(`low_light:${image.angle}`);
      }
      if (!analysis.poseOk) {
        qualityFlags.add(`pose:${image.angle}`);
      }

      await prisma.scanImage.update({
        where: { id: image.id },
        data: {
          blurScore: analysis.blurScore,
          lightScore: analysis.lightScore,
          poseOk: analysis.poseOk,
          landmarks: analysis.landmarks
        }
      });
    } catch {
      qualityFlags.add(`processing_error:${image.angle}`);
    }
  }

  const anglesPresent = new Set(scan.images.map((image) => image.angle));
  const missingAngles = REQUIRED_ANGLES.filter((angle) => !anglesPresent.has(angle));
  if (missingAngles.length) {
    missingAngles.forEach((angle) => qualityFlags.add(`missing_angle:${angle}`));
  }

  const hasChecksumMismatch = Array.from(qualityFlags).some((flag) =>
    flag.startsWith("checksum_mismatch")
  );
  const status = hasChecksumMismatch
    ? "rejected"
    : missingAngles.length
      ? "processing"
      : "complete";

  return prisma.scan.update({
    where: { id: scan.id },
    data: {
      qualityFlags: Array.from(qualityFlags),
      missingAngles,
      status
    },
    include: { images: true }
  });
}
