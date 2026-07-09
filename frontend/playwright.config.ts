import { defineConfig, devices } from '@playwright/test'

// The Phase-1 E2E runs against the LIVE, single-origin app served by FastAPI.
// Override with BASE_URL if the server is elsewhere.
const baseURL = process.env.BASE_URL ?? 'http://localhost:8001/app/'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
