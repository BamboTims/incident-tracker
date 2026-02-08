import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppRuntime } from "../../src/app.js";
import { createTestRuntime } from "../helpers/create-test-runtime.js";

describe("views integration", () => {
  let runtime: AppRuntime;

  beforeEach(async () => {
    runtime = await createTestRuntime();
  });

  afterEach(async () => {
    await runtime.close();
  });

  it("redirects root to /app and serves all view routes from app shell", async () => {
    const rootResponse = await request(runtime.app).get("/");
    expect(rootResponse.status).toBe(302);
    expect(rootResponse.headers.location).toBe("/app");

    const routes = ["/app", "/app/audit-logs", "/app/usage", "/app/api-keys"];
    for (const route of routes) {
      const response = await request(runtime.app).get(route);
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain("text/html");
      expect(response.text).toContain("Operator Console");
      expect(response.text).toContain("Audit Logs View");
      expect(response.text).toContain("Usage View");
      expect(response.text).toContain("API Keys View");
    }
  });
});
