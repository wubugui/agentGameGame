/**
 * Resolve the pre-installed Chromium in this environment rather than letting
 * Playwright download a build that matches its own version. PLAYWRIGHT_BROWSERS_PATH
 * points at a pinned build; if the installed Playwright expects a different one,
 * launching by executablePath is the supported escape hatch.
 */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const CANDIDATES = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
];

export function chromiumPath() {
  return CANDIDATES.find((p) => existsSync(p)) || undefined;
}

/** SwiftShader software GL — no GPU in this container, but WebGL2 still works. */
export const GL_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--disable-gpu-sandbox',
  '--no-sandbox',
];

export function launch(extra = {}) {
  return chromium.launch({ executablePath: chromiumPath(), args: GL_ARGS, ...extra });
}
