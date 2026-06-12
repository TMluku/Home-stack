import test from "node:test";
import assert from "node:assert/strict";
import { createHomeStackServer } from "../server/api-server.mjs";

async function withServer(callback) {
  const server = createHomeStackServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test("GET /api/inventory returns the default inventory list", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/inventory`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(Array.isArray(payload.data), true);
    assert.equal(payload.data.some((item) => item.id === "cat-litter"), true);
  });
});

test("POST /api/inventory creates sanitized inventory through the REST adapter", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/inventory`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "テスト洗剤", category: "invalid", stock: 999, dailyUsage: -10 }),
    });
    const payload = await response.json();

    assert.equal(response.status, 201);
    assert.equal(payload.data.name, "テスト洗剤");
    assert.equal(payload.data.category, "洗濯・掃除");
    assert.equal(payload.data.stock, 100);
    assert.equal(payload.data.dailyUsage, 1);
  });
});

test("PATCH /api/queue/:id updates queue decisions and metrics", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/queue/cat-litter`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", estimatedRevenue: 25 }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload.data, { action: "approve", itemId: "cat-litter" });

    const exported = await fetch(`${baseUrl}/api/state/export`).then((result) => result.json());
    assert.equal(exported.data.queueDecisions["cat-litter"], "approve");
    assert.equal(exported.data.metrics.approvals, 1);
    assert.equal(exported.data.metrics.estimatedRevenue, 25);
  });
});

test("GET / serves the static app shell", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/html/);
    assert.match(html, /Home Stack/);
  });
});

test("invalid JSON returns a REST-style 400 error", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/inventory`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{invalid",
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.message, "Invalid request body");
  });
});
