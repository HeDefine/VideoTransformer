import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
    video: "retain-on-failure"
  },
  webServer: [
    {
      command: "npm run dev -- --host 127.0.0.1 --port 4173",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: true,
      timeout: 120_000
    },
    {
      command: "npm run dev -- --host 127.0.0.1 --port 4174",
      url: "http://127.0.0.1:4174",
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        VITE_DISABLE_CROSS_ORIGIN_ISOLATION: "true"
      }
    }
  ],
  projects: [
    {
      name: "chromium-isolated",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://127.0.0.1:4173"
      }
    },
    {
      name: "webkit-isolated",
      use: {
        ...devices["Desktop Safari"],
        baseURL: "http://127.0.0.1:4173"
      }
    },
    {
      name: "chromium-single-thread",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://127.0.0.1:4174"
      }
    },
    {
      name: "webkit-single-thread",
      use: {
        ...devices["Desktop Safari"],
        baseURL: "http://127.0.0.1:4174"
      }
    }
  ]
});
