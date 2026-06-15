import { categories, detectedInventoryCandidates } from "./demo-state";
import type { InventoryItem } from "./types";

export type PhotoDetectionProviderStatus = {
  kind: "demo-catalog" | "external-http";
  configuredBy: "default" | "env";
  endpoint?: string;
  ready: boolean;
  timeoutMs: number;
  checkedAt: string;
};

export type PhotoDetectedInventoryCandidate = Omit<InventoryItem, "id" | "autoReplenish"> & {
  confidence: "high" | "medium" | "low";
  evidence: string[];
};

export type PhotoDetectionResult = {
  provider: PhotoDetectionProviderStatus;
  source: "demo-catalog" | "external-http";
  candidates: PhotoDetectedInventoryCandidate[];
  evidence: string[];
};

const DEFAULT_TIMEOUT_MS = 12_000;

export function getPhotoDetectionProviderStatus(checkedAt = new Date().toISOString()): PhotoDetectionProviderStatus {
  const endpoint = process.env.HOME_STACK_IMAGE_RECOGNITION_URL?.trim();
  return {
    kind: endpoint ? "external-http" : "demo-catalog",
    configuredBy: endpoint ? "env" : "default",
    endpoint: endpoint || undefined,
    ready: true,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    checkedAt,
  };
}

export async function detectInventoryFromPhoto({
  imageData,
  mimeType,
  checkedAt = new Date().toISOString(),
}: {
  imageData?: string;
  mimeType?: string;
  checkedAt?: string;
}): Promise<PhotoDetectionResult> {
  const provider = getPhotoDetectionProviderStatus(checkedAt);
  if (provider.kind !== "external-http" || !provider.endpoint || !imageData) {
    return {
      provider,
      source: "demo-catalog",
      candidates: buildDemoPhotoCandidates(),
      evidence: ["external image recognition is not configured; returned demo photo candidates"],
    };
  }

  try {
    const candidates = await fetchExternalPhotoDetections(provider.endpoint, { imageData, mimeType });
    return {
      provider,
      source: candidates.length > 0 ? "external-http" : "demo-catalog",
      candidates: candidates.length > 0 ? candidates : buildDemoPhotoCandidates(),
      evidence:
        candidates.length > 0
          ? ["matched external image recognition response", "normalized external photo detection payload"]
          : ["external image recognition returned no candidates", "returned demo photo candidates"],
    };
  } catch (error) {
    return {
      provider,
      source: "demo-catalog",
      candidates: buildDemoPhotoCandidates(),
      evidence: [
        `external image recognition failed: ${error instanceof Error ? error.message : "unknown error"}`,
        "returned demo photo candidates",
      ],
    };
  }
}

function buildDemoPhotoCandidates(): PhotoDetectedInventoryCandidate[] {
  return detectedInventoryCandidates.map((candidate) => ({
    ...candidate,
    confidence: "medium",
    evidence: ["demo photo candidate"],
  }));
}

async function fetchExternalPhotoDetections(
  endpoint: string,
  payload: { imageData: string; mimeType?: string },
): Promise<PhotoDetectedInventoryCandidate[]> {
  const token = process.env.HOME_STACK_IMAGE_RECOGNITION_TOKEN?.trim();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "user-agent": "HomeStackPhotoDetector/0.1 (+https://github.com/TMluku/Home-stack)",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const parsed = (await response.json()) as unknown;
  return unwrapDetectionRecords(parsed)
    .map(normalizeDetectionRecord)
    .filter((candidate): candidate is PhotoDetectedInventoryCandidate => Boolean(candidate));
}

function unwrapDetectionRecords(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];
  const nested = payload.items ?? payload.results ?? payload.detections ?? payload.products ?? payload.candidates ?? payload.data;
  if (Array.isArray(nested)) return nested.filter(isRecord);
  if (isRecord(nested)) return unwrapDetectionRecords(nested);
  return [payload];
}

function normalizeDetectionRecord(record: Record<string, unknown>): PhotoDetectedInventoryCandidate | null {
  const name = readString(record, ["name", "productName", "product_name", "itemName", "label", "title"]);
  if (!name) return null;
  const category = normalizeCategory(readString(record, ["category", "categoryName", "category_name", "genre", "type"]));
  const stock = readNumber(record, ["stock", "stockPercent", "remainingPercent", "remaining", "level"]) ?? 50;
  const dailyUsage = readNumber(record, ["dailyUsage", "daily_usage", "usagePerDay", "usage", "consumption"]) ?? 5;
  const confidenceScore = readNumber(record, ["confidence", "score", "probability"]);

  return {
    name,
    category,
    stock: clamp(Math.round(stock), 5, 100),
    dailyUsage: clamp(Math.round(dailyUsage), 1, 30),
    note: readString(record, ["note", "memo", "reason", "description"]) ?? "external image recognition candidate",
    confidence: toConfidence(confidenceScore),
    evidence: [
      "external image recognition candidate",
      confidenceScore !== undefined ? `confidence: ${confidenceScore}` : "",
      readString(record, ["model", "source"]) ? `source: ${readString(record, ["model", "source"])}` : "",
    ].filter(Boolean),
  };
}

function normalizeCategory(value?: string) {
  if (value && categories.some((category) => category === value)) return value;
  return categories[0] ?? "未分類";
}

function toConfidence(value?: number): PhotoDetectedInventoryCandidate["confidence"] {
  if (value === undefined) return "medium";
  const normalized = value > 1 ? value / 100 : value;
  if (normalized >= 0.75) return "high";
  if (normalized >= 0.45) return "medium";
  return "low";
}

function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function readNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : undefined;
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
