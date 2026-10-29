import { Clipboard, closeMainWindow, getPreferenceValues, showToast, Toast } from "@raycast/api";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parseLanguageList, selectLanguage } from "./menu-locale";

const run = promisify(execFile);

const APP = "/Applications/Screenflare.app";
const INFO_PLIST = path.join(APP, "Contents/Info.plist");
const RESOURCES = path.join(APP, "Contents/Resources");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Screenflare needs Accessibility to be driven from outside; fail before the menu press with a clear message. */
async function ensureTrusted() {
  const { stdout } = await run("osascript", ["-e", `tell application "System Events" to return UI elements enabled`]);
  if (stdout.trim() !== "true") {
    throw new Error(
      "Raycast needs Accessibility access. Enable it in System Settings ▸ Privacy & Security ▸ Accessibility.",
    );
  }
}

async function ensureRunning() {
  if (await isRunning()) return;
  await run("open", ["-g", "-a", APP]);
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await isRunning()) return;
    await sleep(200);
  }
  throw new Error(`Screenflare did not start from ${APP}`);
}

const isRunning = async () =>
  (
    await run("osascript", [
      "-e",
      `tell application "System Events" to return (count of (every process whose bundle identifier is "app.screenflare")) > 0`,
    ])
  ).stdout.trim() === "true";

type MenuAction =
  | "recordDisplay"
  | "recordArea"
  | "stopRecording"
  | "recordWindow"
  | "captureFullscreen"
  | "captureArea"
  | "captureText"
  | "captureWindow"
  | "scrollingCapture"
  | "screenshotHistory"
  | "recordingHistory"
  | "captureBar";

/**
 * Screenflare has no automation API, so its menus are the only hook. Titles are
 * read from the app's own localization rather than hardcoded English.
 */
const MENU_KEYS: Record<MenuAction, readonly string[]> = {
  recordDisplay: ["menu.file", "menu.file.recordDisplay"],
  recordArea: ["menu.file", "menu.file.recordArea"],
  stopRecording: ["menu.file", "menu.file.stopRecording"],
  recordWindow: ["menu.file", "menu.file.recordWindow"],
  captureFullscreen: ["menu.file", "menu.file.captureFullscreen"],
  // "Capture Screenshot" opens the region overlay. A keystroke after it cancels the overlay.
  captureArea: ["menu.file", "menu.file.captureScreenshot"],
  captureText: ["menu.file", "menu.file.captureText"],
  captureWindow: ["menu.file", "menu.file.captureWindow"],
  scrollingCapture: ["menu.file", "menu.file.captureScrolling"],
  screenshotHistory: ["menu.file", "menu.file.screenshotHistory"],
  recordingHistory: ["menu.file", "menu.file.previousProjects"],
  captureBar: ["menu.file", "menu.file.captureBar"],
};

const PERMISSION_ERRORS = [
  "not authorized to send apple events",
  "not allowed to send apple events",
  "-1743",
  "assistive access",
  "not allowed to send keystrokes",
  "not authorized to send keystrokes",
  "-1719",
];

function isPermissionError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return PERMISSION_ERRORS.some((needle) => message.includes(needle));
}

export function explainError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("apple events") || lower.includes("-1743")) {
    return "Raycast is not allowed to control System Events. Allow it in System Settings ▸ Privacy & Security ▸ Automation.";
  }
  if (lower.includes("assistive access") || lower.includes("keystrokes") || lower.includes("-1719")) {
    return "Raycast needs Accessibility access. Enable it in System Settings ▸ Privacy & Security ▸ Accessibility.";
  }
  return message;
}

async function appVersion(): Promise<string> {
  try {
    return (
      await run("plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", INFO_PLIST])
    ).stdout.trim();
  } catch {
    return "unknown";
  }
}

async function readDefaults(args: string[]): Promise<string[]> {
  try {
    return parseLanguageList((await run("defaults", args)).stdout);
  } catch {
    return [];
  }
}

async function readPreferredLanguages(): Promise<string[]> {
  const perApp = await readDefaults(["read", "app.screenflare", "AppleLanguages"]);
  if (perApp.length > 0) return perApp;
  return readDefaults(["read", "-g", "AppleLanguages"]);
}

async function availableLanguages(): Promise<string[]> {
  try {
    const parsed: unknown = JSON.parse(
      (await run("plutil", ["-extract", "CFBundleLocalizations", "json", "-o", "-", INFO_PLIST])).stdout,
    );
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : ["en"];
  } catch {
    return ["en"];
  }
}

async function readStrings(language: string): Promise<Record<string, string>> {
  const { stdout } = await run("plutil", [
    "-convert",
    "json",
    "-o",
    "-",
    path.join(RESOURCES, `${language}.lproj`, "Localizable.strings"),
  ]);
  const parsed: unknown = JSON.parse(stdout);
  const strings: Record<string, string> = {};
  if (typeof parsed === "object" && parsed !== null) {
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") strings[key] = value;
    }
  }
  return strings;
}

async function loadMenuItems(): Promise<Record<MenuAction, string[]>> {
  const version = await appVersion();
  const language = selectLanguage(await readPreferredLanguages(), await availableLanguages());
  const english = await readStrings("en").catch((error: unknown) => {
    throw new Error(`Screenflare ${version}: ${messageOf(error)}`);
  });
  const localized = language === "en" ? english : await readStrings(language).catch(() => english);
  const items = {} as Record<MenuAction, string[]>;
  for (const action of Object.keys(MENU_KEYS) as MenuAction[]) {
    items[action] = MENU_KEYS[action].map((key) => {
      const title = localized[key] || english[key];
      if (!title) {
        throw new Error(`Screenflare ${version} (${language}) has no menu title for "${key}"`);
      }
      return title;
    });
  }
  return items;
}

let menuItemsPromise: Promise<Record<MenuAction, string[]>> | undefined;

function resolveMenuItems(): Promise<Record<MenuAction, string[]>> {
  if (!menuItemsPromise) {
    menuItemsPromise = loadMenuItems().catch((error: unknown) => {
      menuItemsPromise = undefined;
      throw error;
    });
  }
  return menuItemsPromise;
}

const runScript = (lines: string[]) =>
  run(
    "osascript",
    lines.flatMap((line) => ["-e", line]),
  );

function menuPathLines(items: string[]): string[] {
  const [bar, ...rest] = items;
  return [
    `tell application "System Events" to tell process "Screenflare"`,
    `set target to menu bar item ${JSON.stringify(bar)} of menu bar 1`,
    ...rest.map((item) => `set target to menu item ${JSON.stringify(item)} of menu 1 of target`),
  ];
}

async function menu(action: MenuAction) {
  const items = (await resolveMenuItems())[action];
  const label = items.join(" ▸ ");
  await runScript([
    ...menuPathLines(items),
    `if not (enabled of target) then error ${JSON.stringify(`${label} is unavailable right now`)}`,
    `click target`,
    `end tell`,
  ]);
}

async function waitForMenu(action: MenuAction) {
  const items = (await resolveMenuItems())[action];
  const lines = [...menuPathLines(items), "return exists target", "end tell"];
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const { stdout } = await runScript(lines);
      if (stdout.trim() === "true") return;
    } catch (error) {
      if (isPermissionError(error)) throw error;
    }
    await sleep(200);
  }
  throw new Error(`Screenflare ${await appVersion()} did not show the menu "${items.join(" ▸ ")}"`);
}

export async function isRecording(): Promise<boolean> {
  await ensureTrusted();
  if (!(await isRunning())) return false;
  await waitForMenu("stopRecording");
  const items = (await resolveMenuItems()).stopRecording;
  const { stdout } = await runScript([...menuPathLines(items), "return enabled of target", "end tell"]);
  return stdout.trim() === "true";
}

export async function capture(action: MenuAction) {
  try {
    // Raycast must not appear in the capture.
    await closeMainWindow();
    await ensureTrusted();
    await ensureRunning();
    await waitForMenu(action);
    await menu(action);
    return true;
  } catch (error) {
    await showToast({ style: Toast.Style.Failure, title: "Screenflare failed", message: explainError(error) });
    return false;
  }
}

/** Screenflare's OCR copies to the clipboard when it finishes, so watch for it. */
export async function captureText() {
  const before = await Clipboard.readText();
  if (!(await capture("captureText"))) return;
  for (let poll = 0; poll < 120; poll++) {
    await sleep(500);
    const now = await Clipboard.readText();
    if (now && now !== before) return;
  }
  await showToast({
    style: Toast.Style.Failure,
    title: "No new text was copied",
    message: "Screenflare may still be open. Text already on the clipboard is unchanged.",
  });
}

export type Recording = { name: string; dir: string; meta: RecordingMeta };
export type RecordingMeta = {
  version: number;
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
  version: number;
  createdAt: string;
  kind: string;
  pixelWidth: number;
  pixelHeight: number;
  exportPath?: string;
};
export type Library<T> = { items: T[]; problems: string[]; error?: string };

type ReadResult = { ok: true; value: unknown } | { ok: false; reason: "missing" | "invalid"; detail?: string };
type ParseResult<T> =
  { ok: true; value: T } | { ok: false; missing: true } | { ok: false; missing: false; problem: string };
type ParseProblem = { ok: false; missing: false; problem: string };

const prefs = getPreferenceValues<Preferences>();
const expand = (p: string) => p.replace(/^~(?=$|\/)/, homedir());
const savedFolder = (pref: string | undefined, fallback: string) =>
  pref?.trim() ? expand(pref.trim()) : path.join(homedir(), "Screenflare", fallback);

const recordingsFolder = savedFolder(prefs.recordingsFolder, "recordings");
const screenshotsFolder = savedFolder(prefs.screenshotsFolder, "screenshots");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function invalid(problem: string): ParseProblem {
  return { ok: false, missing: false, problem };
}

function unsupportedVersion(version: unknown): string {
  return version === undefined ? "meta.json has no version" : `unsupported meta version ${String(version)}`;
}

async function readJSON(file: string): Promise<ReadResult> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: false, reason: "missing" };
    return { ok: false, reason: "invalid", detail: messageOf(error) };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, reason: "invalid", detail: messageOf(error) };
  }
}

async function readDirs(dir: string): Promise<{ dirs: string[]; error?: string }> {
  if (!path.isAbsolute(dir)) return { dirs: [], error: `Folder path is not absolute: ${dir}` };
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return { dirs: entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(dir, entry.name)) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { dirs: [], error: `Folder not found: ${dir}` };
    return { dirs: [], error: `${messageOf(error)} (${dir})` };
  }
}

function parseRecordingMeta(read: ReadResult): ParseResult<RecordingMeta> {
  if (!read.ok) {
    return read.reason === "missing" ? { ok: false, missing: true } : invalid(read.detail ?? "meta.json is unreadable");
  }
  const raw = read.value;
  if (!isRecord(raw)) return invalid("meta.json is not an object");
  if (raw.version !== 1) return invalid(unsupportedVersion(raw.version));
  if (typeof raw.createdAt !== "string") return invalid("createdAt is missing or not a string");
  if (typeof raw.duration !== "number") return invalid("duration is missing or not a number");
  if (typeof raw.mode !== "string") return invalid("mode is missing or not a string");
  if (typeof raw.sourceName !== "string") return invalid("sourceName is missing or not a string");
  if (typeof raw.pixelWidth !== "number") return invalid("pixelWidth is missing or not a number");
  if (typeof raw.pixelHeight !== "number") return invalid("pixelHeight is missing or not a number");
  return {
    ok: true,
    value: {
      version: 1,
      createdAt: raw.createdAt,
      duration: raw.duration,
      mode: raw.mode,
      sourceName: raw.sourceName,
      pixelWidth: raw.pixelWidth,
      pixelHeight: raw.pixelHeight,
    },
  };
}

function parseScreenshotMeta(read: ReadResult): ParseResult<ScreenshotMeta> {
  if (!read.ok) {
    return read.reason === "missing" ? { ok: false, missing: true } : invalid(read.detail ?? "meta.json is unreadable");
  }
  const raw = read.value;
  if (!isRecord(raw)) return invalid("meta.json is not an object");
  if (raw.version !== 1) return invalid(unsupportedVersion(raw.version));
  if (typeof raw.createdAt !== "string") return invalid("createdAt is missing or not a string");
  if (typeof raw.kind !== "string") return invalid("kind is missing or not a string");
  if (typeof raw.pixelWidth !== "number") return invalid("pixelWidth is missing or not a number");
  if (typeof raw.pixelHeight !== "number") return invalid("pixelHeight is missing or not a number");
  if (raw.exportPath !== undefined && typeof raw.exportPath !== "string") return invalid("exportPath is not a string");
  return {
    ok: true,
    value: {
      version: 1,
      createdAt: raw.createdAt,
      kind: raw.kind,
      pixelWidth: raw.pixelWidth,
      pixelHeight: raw.pixelHeight,
      exportPath: raw.exportPath,
    },
  };
}

const exists = (file: string) =>
  fs.access(file).then(
    () => true,
    () => false,
  );

const byNewest = <T extends { createdAt: string }>(a: T, b: T) => b.createdAt.localeCompare(a.createdAt);

/** Screenflare's history.json only indexes recordings, so read the library off disk. */
export async function listRecordings(): Promise<Library<Recording>> {
  const { dirs, error } = await readDirs(recordingsFolder);
  const items: Recording[] = [];
  const problems: string[] = [];
  for (const dir of dirs) {
    const meta = parseRecordingMeta(await readJSON(path.join(dir, "meta.json")));
    if (!meta.ok) {
      if (!meta.missing) problems.push(`${path.basename(dir)}: ${meta.problem}`);
      continue;
    }
    items.push({ name: path.basename(dir, ".screenflare"), dir, meta: meta.value });
  }
  items.sort((a, b) => byNewest(a.meta, b.meta));
  return { items, problems, error };
}

export async function listScreenshots(): Promise<Library<Screenshot>> {
  const { dirs, error } = await readDirs(screenshotsFolder);
  const items: Screenshot[] = [];
  const problems: string[] = [];
  for (const dir of dirs) {
    const meta = parseScreenshotMeta(await readJSON(path.join(dir, "meta.json")));
    if (!meta.ok) {
      if (!meta.missing) problems.push(`${path.basename(dir)}: ${meta.problem}`);
      continue;
    }
    const thumb = path.join(dir, "thumbnail.png");
    const image = meta.value.exportPath && (await exists(meta.value.exportPath)) ? meta.value.exportPath : thumb;
    items.push({ dir, image, thumb, meta: meta.value });
  }
  items.sort((a, b) => byNewest(a.meta, b.meta));
  return { items, problems, error };
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
