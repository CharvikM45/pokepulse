import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
await mkdir("test-results/components/browser", { recursive: true });
await mkdir("test-results/components/screenshots", { recursive: true });
const server = spawn(process.execPath, ["tests/harness/server.mjs"], {
  stdio: ["ignore", "inherit", "inherit", "ipc"],
  windowsHide: true,
});
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Fixture server did not start.")),
      5000,
    );
    server.once("message", (message) => {
      clearTimeout(timer);
      if (message === "ready") resolve();
      else reject(new Error("Invalid fixture server acknowledgment."));
    });
    server.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Fixture server exited: ${code}`));
    });
  });
  const suites = [
    "components-qa",
    "features-qa",
    "calendar-ui-qa",
    "radar-ui-qa",
    "lab-ui-qa",
    "release-editor-ui-qa",
    "binder-ui-qa",
  ];
  const selected = process.argv.slice(2);
  if (selected.some((name) => !suites.includes(name)))
    throw new Error("Unknown component suite.");
  for (const suite of selected.length ? selected : suites) {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [`tests/harness/${suite}.mjs`], {
        stdio: "inherit",
        windowsHide: true,
      });
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`${suite} failed: ${code}`)),
      );
    });
  }
} finally {
  server.kill();
}
