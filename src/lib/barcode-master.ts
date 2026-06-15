import { type BarcodeResolution, normalizeJanCode, resolveBarcode } from "./post-mvp";

export type BarcodeMasterProduct = {
  janCode: string;
  name: string;
  category: string;
  unitHint: string;
};

export type BarcodeMasterStatus = {
  kind: "demo-catalog" | "external-http";
  configuredBy: "default" | "env";
  endpoint?: string;
  ready: boolean;
  timeoutMs: number;
  supportedFormats: Array<BarcodeResolution["format"]>;
  checkedAt: string;
};

export type BarcodeMasterLookup = {
  resolution: BarcodeResolution;
  provider: BarcodeMasterStatus;
  source: "demo-catalog" | "external-http" | "none";
  matched: boolean;
  evidence: string[];
};

const DEFAULT_TIMEOUT_MS = 8_000;

export function getBarcodeMasterStatus(checkedAt = new Date().toISOString()): BarcodeMasterStatus {
  const endpoint = process.env.HOME_STACK_BARCODE_MASTER_URL?.trim();
  return {
    kind: endpoint ? "external-http" : "demo-catalog",
    configuredBy: endpoint ? "env" : "default",
    endpoint: endpoint || undefined,
    ready: true,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    supportedFormats: ["jan-13", "jan-8"],
    checkedAt,
  };
}

export async function resolveBarcodeWithMaster(value: string, checkedAt = new Date().toISOString()): Promise<BarcodeMasterLookup> {
  const provider = getBarcodeMasterStatus(checkedAt);
  const resolution = resolveBarcode(value);
  const demoMatched = Boolean(resolution.product);

  if (provider.kind !== "external-http" || !provider.endpoint || !resolution.valid) {
    return {
      resolution,
      provider,
      source: demoMatched ? "demo-catalog" : "none",
      matched: demoMatched,
      evidence: [demoMatched ? "matched demo JAN catalog" : "external JAN master is not configured or barcode is not valid"],
    };
  }

  try {
    const product = await fetchExternalBarcodeProduct(provider.endpoint, resolution.normalized);
    if (!product) {
      return {
        resolution,
        provider,
        source: demoMatched ? "demo-catalog" : "none",
        matched: demoMatched,
        evidence: ["external JAN master returned no product", ...(demoMatched ? ["matched demo JAN catalog"] : [])],
      };
    }

    return {
      resolution: {
        ...resolution,
        product,
      },
      provider,
      source: "external-http",
      matched: true,
      evidence: ["matched external JAN master"],
    };
  } catch (error) {
    return {
      resolution,
      provider,
      source: demoMatched ? "demo-catalog" : "none",
      matched: demoMatched,
      evidence: [
        `external JAN master failed: ${error instanceof Error ? error.message : "unknown error"}`,
        ...(demoMatched ? ["matched demo JAN catalog"] : []),
      ],
    };
  }
}

async function fetchExternalBarcodeProduct(endpoint: string, janCode: string): Promise<BarcodeMasterProduct | null> {
  const url = new URL(endpoint);
  url.searchParams.set("janCode", normalizeJanCode(janCode));

  const response = await fetch(url.toString(), {
    headers: {
      accept: "application/json",
      "user-agent": "HomeStackBarcodeResolver/0.1 (+https://github.com/TMluku/Home-stack)",
    },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const payload = (await response.json()) as unknown;
  return parseBarcodeMasterProduct(payload);
}

function parseBarcodeMasterProduct(payload: unknown): BarcodeMasterProduct | null {
  const record = unwrapProductRecord(payload);
  if (!record) return null;

  const janCode = readString(record, ["janCode", "jan", "barcode", "code"]);
  const name = readString(record, ["name", "productName", "title"]);
  const category = readString(record, ["category", "categoryName"]) ?? "未分類";
  const unitHint = readString(record, ["unitHint", "unit", "size"]) ?? "";

  if (!janCode || !name) return null;
  return {
    janCode: normalizeJanCode(janCode),
    name,
    category,
    unitHint,
  };
}

function unwrapProductRecord(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const product = record.product;
  if (product && typeof product === "object") return product as Record<string, unknown>;
  const firstItem = Array.isArray(record.items) ? record.items[0] : undefined;
  if (firstItem && typeof firstItem === "object") return firstItem as Record<string, unknown>;
  return record;
}

function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}
