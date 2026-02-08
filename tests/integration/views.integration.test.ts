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

  it("redirects root to /app and serves the app shell", async () => {
    const rootResponse = await request(runtime.app).get("/");
    expect(rootResponse.status).toBe(302);
    expect(rootResponse.headers.location).toBe("/app");

    const appResponse = await request(runtime.app).get("/app");
    expect(appResponse.status).toBe(200);
    expect(appResponse.headers["content-type"]).toContain("text/html");
    expect(appResponse.text).toContain("Operator Views");
  });
});
