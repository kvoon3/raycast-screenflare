import { Clipboard, getPreferenceValues, showToast, Toast } from "@raycast/api";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export const APP = "/Applications/Screenflare.app";

/** Screenflare needs Accessibility to be driven from outside; ask once, up front. */
async function ensureTrusted() {
  const { stdout } = await run("osascript", ["-e", `tell application "System Events" to return UI elements enabled`]);
  if (stdout.trim() !== "true") {
    throw new Error(
      "Raycast needs Accessibility access. Enable it in System Settings ▸ Privacy & Security ▸ Accessibility.",
    );
  }
}

/** Launching a bare `open <app>` works while the app is already running, so force a cold start. */
async function ensureRunning() {
  if (await isRunning()) return;
  await run("open", ["-g", "-a", APP]);
  for (let i = 0; i < 50; i++) {
    if (await isRunning()) return sleep(1500);
    await sleep(200);
  }
  throw new Error("Screenflare did not start");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isRunning = async () =>
  (
    await run("osascript", [
      "-e",
      `tell application "System Events" to return (count of (every process whose bundle identifier is "app.screenflare")) > 0`,
    ])
  ).stdout.trim() === "true";

/**
 * Screenflare ships no URL scheme, AppleScript dictionary or CLI, so its menus
 * are the only hook. AXPress is exact — unlike synthetic keystrokes, which
 * break when the user rebinds a shortcut.
 */
async function menu(...items: string[]) {
  const [bar, ...rest] = items;
  const lines = [
    `tell application "System Events" to tell process "Screenflare"`,
    `set target to menu bar item "${bar}" of menu bar 1`,
    ...rest.slice(0, -1).map((i) => `set target to menu item "${i}" of menu 1 of target`),
    `set target to menu item "${rest[rest.length - 1]}" of menu 1 of target`,
    `if not (enabled of target) then error "${items.join(" ▸ ")} is unavailable right now"`,
    `click target`,
    `end tell`,
  ];
  await run(
    "osascript",
    lines.flatMap((l) => ["-e", l]),
  );
}

export const isRecording = async () =>
  (
    await run("osascript", [
      "-e",
      `tell application "System Events" to tell process "Screenflare" to return enabled of menu item "Stop Recording" of menu 1 of menu bar item "File" of menu bar 1`,
    ]).catch(() => ({ stdout: "false" }))
  ).stdout.trim() === "true";

type Capture =
  | "recording"
  | "stop-recording"
  | "window"
  | "screenshot"
  | "area"
  | "text"
  | "window-shot"
  | "scrolling"
  | "history"
  | "recording-history"
  | "bar";

const MENU_ITEMS: Record<Capture, string[]> = {
  recording: ["File", "Record Display"],
  "stop-recording": ["File", "Stop Recording"],
  window: ["File", "Record Window"],
  screenshot: ["File", "Capture Fullscreen"],
  area: ["File", "Capture Screenshot"],
  text: ["File", "Capture Text"],
  "window-shot": ["File", "Capture Window"],
  scrolling: ["File", "Scrolling Capture"],
  history: ["File", "Screenshot History…"],
  "recording-history": ["File", "Recording History…"],
  bar: ["File", "Record or Capture…"],
};

/**
 * Screenflare's own "Capture Screenshot" menu item raises the region-selection
 * overlay itself, so no synthetic ⌘⇧4 is needed. This also keeps the command
 * independent of whether macOS or Screenflare owns the screenshot shortcuts.
 */

export async function capture(what: Capture) {
  try {
    await ensureTrusted();
    await ensureRunning();
    await menu(...MENU_ITEMS[what]);
    return true;
  } catch (error) {
    await showToast({ style: Toast.Style.Failure, title: "Screenflare failed", message: String(error) });
    return false;
  }
}

/** Screenflare's OCR copies to the clipboard when it finishes, so watch for it. */
export async function captureText() {
  const before = await Clipboard.readText();
  if (!(await capture("text"))) return;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const now = await Clipboard.readText();
    if (now && now !== before) return; // No HUD confirms OCR, so the clipboard is the signal
  }
  await menu("File", "Screenshot History…"); // nothing copied: let the user grab it by hand
}

export type Recording = { name: string; dir: string; meta: RecordingMeta };
export type RecordingMeta = {
  createdAt: string;
  duration: number;
  mode: string;
  sourceName: string;
  pixelWidth: number;
  pixelHeight: number;
};
export type Screenshot = {
  dir: string;
  /** Full-quality capture when the export still exists, else the 640pt thumbnail. */ image: string;
  thumb: string;
  meta: ScreenshotMeta;
};
export type ScreenshotMeta = {
  createdAt: string;
  kind: string;
  pixelWidth: number;
  pixelHeight: number;
  exportPath?: string;
};

const prefs = getPreferenceValues<{ recordingsFolder?: string; screenshotsFolder?: string }>();
const expand = (p: string) => p.replace(/^~(?=$|\/)/, homedir());
const savedFolder = (pref: string | undefined, fallback: string) =>
  pref?.trim() ? expand(pref.trim()) : path.join(homedir(), "Screenflare", fallback);

export const recordingsFolder = savedFolder(prefs.recordingsFolder, "recordings");
export const screenshotsFolder = savedFolder(prefs.screenshotsFolder, "screenshots");

async function readJSON<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return undefined; // half-written or missing: skip the entry rather than the whole library
  }
}

const exists = (file: string) =>
  fs.access(file).then(
    () => true,
    () => false,
  );

const readDirs = (dir: string) =>
  fs.readdir(dir, { withFileTypes: true }).then(
    (e) => e.filter((d) => d.isDirectory()).map((d) => path.join(dir, d.name)),
    () => [],
  );

const byNewest = <T extends { createdAt: string }>(a: T, b: T) => b.createdAt.localeCompare(a.createdAt);

/** Screenflare's history.json only indexes recordings, so read the library off disk. */
export async function listRecordings(): Promise<Recording[]> {
  const entries = await Promise.all(
    (await readDirs(recordingsFolder)).map(async (dir) => {
      const meta = await readJSON<RecordingMeta>(path.join(dir, "meta.json"));
      return meta?.createdAt ? { name: path.basename(dir, ".screenflare"), dir, meta } : undefined;
    }),
  );
  return entries.filter((r): r is Recording => !!r).sort((a, b) => byNewest(a.meta, b.meta));
}

export async function listScreenshots(): Promise<Screenshot[]> {
  const entries = await Promise.all(
    (await readDirs(screenshotsFolder)).map(async (dir) => {
      const meta = await readJSON<ScreenshotMeta>(path.join(dir, "meta.json"));
      if (!meta?.createdAt) return undefined;
      const thumb = path.join(dir, "thumbnail.png");
      const image = meta.exportPath && (await exists(meta.exportPath)) ? meta.exportPath : thumb;
      return { dir, image, thumb, meta };
    }),
  );
  return entries.filter((s): s is Screenshot => !!s).sort((a, b) => byNewest(a.meta, b.meta));
}

/** Opens the recording in Screenflare's editor, revealing it in Finder if the app refuses. */
export async function openRecording(dir: string) {
  try {
    await run("open", ["-a", APP, dir]);
  } catch {
    await showToast({
      style: Toast.Style.Failure,
      title: "Screenflare could not open it",
      message: "Revealed in Finder",
    });
    await run("open", ["-R", dir]);
  }
}
