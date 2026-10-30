import { Clipboard, closeMainWindow, getPreferenceValues, showHUD, showToast, Toast } from "@raycast/api";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * ScreenflareX owns the control surface: an injected library runs actions inside the app
 * and answers over `screenflarex://` and a local socket. Nothing here touches the menu
 * bar from the outside, so there is no Accessibility grant, no AppleScript, and no
 * synthetic clicks — `open screenflarex://capture-window` is the whole call.
 *
 * Two commands still need a *value* back rather than a fire-and-forget: `state` (is it
 * recording?) and the clipboard wait for Capture Text. Those go through the app's own
 * CLI, which speaks to the same controller and returns JSON.
 */
export type ActionId =
  | "capture-area"
  | "capture-window"
  | "capture-fullscreen"
  | "capture-scrolling"
  | "capture-text"
  | "record-display"
  | "record-window"
  | "record-area"
  | "record-or-capture"
  | "stop-recording"
  | "pause-recording"
  | "new-recording"
  | "open-last-recording"
  | "screenshot-history"
  | "recording-history";

export type CtlState = {
  running: boolean;
  recording: boolean;
  paused: boolean;
  actions?: { id: string; enabled: boolean; title: string }[];
};

type CtlOk = { ok: true; state?: CtlState; artifact?: string | null; kind?: string };
type CtlError = { ok: false; error: { code?: string; message: string } };
type CtlResult = CtlOk | CtlError;

const prefs = getPreferenceValues<Preferences>();

const APP = "/Applications/ScreenflareX.app";
const DEFAULT_BUNDLE = path.join(homedir(), "Applications/ScreenflareX.app");

/** The copy `patches/prepare.sh` assembles: preference, env, then the usual two places. */
function bundleCandidates(): string[] {
  return [prefs.screenflarexApp?.trim(), process.env.SCREENFLAREX_APP, DEFAULT_BUNDLE, APP].filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
}

let cliPathPromise: Promise<string> | undefined;

async function cliPath(): Promise<string> {
  if (!cliPathPromise) {
    cliPathPromise = (async () => {
      for (const bundle of bundleCandidates()) {
        if (!path.isAbsolute(bundle)) continue;
        const candidate = path.join(bundle, "Contents/MacOS/screenflarexctl");
        try {
          await fs.access(candidate);
          return candidate;
        } catch {
          continue;
        }
      }
      throw new Error("ScreenflareX was not found. Run `make prepare` in your screenflarex checkout, or set its app path in this extension's preferences.");
    })().catch((error: unknown) => {
      cliPathPromise = undefined;
      throw error;
    });
  }
  return cliPathPromise;
}

async function ctl(command: string): Promise<CtlResult> {
  const binary = await cliPath();
  const { stdout } = await run(binary, [command], { maxBuffer: 4 * 1024 * 1024 }).catch((error: unknown) => {
    // The CLI prints JSON even when the app refuses, and exits non-zero.
    const failed = error as { stdout?: string; stderr?: string };
    if (failed.stdout?.trim()) return { stdout: failed.stdout, stderr: failed.stderr ?? "" };
    throw new Error(failed.stderr?.trim() || String(error));
  });
  const line = stdout.trim().split("\n").filter(Boolean).pop();
  if (!line) throw new Error("screenflarexctl produced no output");
  try {
    return JSON.parse(line) as CtlResult;
  } catch {
    throw new Error(`screenflarexctl produced unreadable output: ${line.slice(0, 200)}`);
  }
}

/** Fire an action through the app's URL scheme. Resolves once Launch Services accepted it. */
async function fire(action: ActionId | `state`): Promise<void> {
  await run("/usr/bin/open", [`screenflarex://${action}`]);
}

export function explainError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("was not found")) {
    return "ScreenflareX is not installed yet: build it with `make prepare` in ~/i/screenflarex.";
  }
  return message;
}

/** Whether a ScreenflareX process is up; a URL launch would otherwise start it silently. */
async function running(): Promise<boolean> {
  try {
    const { stdout } = await run("/usr/bin/pgrep", ["-f", "ScreenflareX.app/Contents/MacOS/Screenflare.real"]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function ensureRunning(): Promise<void> {
  if (await running()) return;
  const bundle = bundleCandidates().find((candidate) => path.isAbsolute(candidate)) ?? DEFAULT_BUNDLE;
  await run("/usr/bin/open", ["-a", bundle]);
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await running()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("ScreenflareX did not start");
}

export async function state(): Promise<CtlState> {
  const result = await ctl("state");
  if (!result.ok) throw new Error(result.error.message);
  return { running: true, recording: false, paused: false, ...(result.state ?? {}) };
}

export async function isRecording(): Promise<boolean> {
  if (!(await running())) return false;
  return (await state()).recording;
}

/** Interactive actions open an overlay; they report nothing, so the HUD is generic. */
const INTERACTIVE: ReadonlySet<ActionId> = new Set([
  "capture-area",
  "capture-window",
  "capture-scrolling",
  "record-window",
  "record-area",
  "record-or-capture",
  "screenshot-history",
  "recording-history",
  "open-last-recording",
]);

export async function capture(action: ActionId): Promise<boolean> {
  try {
    await closeMainWindow({ clearRootSearch: true });
    await ensureRunning();
    await fire(action);
    await showHUD(INTERACTIVE.has(action) ? "ScreenflareX: overlay open (Esc to cancel)" : "ScreenflareX: done");
    return true;
  } catch (error) {
    await showToast({ style: Toast.Style.Failure, title: "ScreenflareX failed", message: explainError(error) });
    return false;
  }
}

/** Screenflare copies recognised text to the clipboard; the URL call cannot return it. */
export async function captureText(): Promise<boolean> {
  try {
    await closeMainWindow({ clearRootSearch: true });
    await ensureRunning();
    const before = (await Clipboard.readText()) ?? "";
    await fire("capture-text");
    for (let poll = 0; poll < 120; poll++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const now = (await Clipboard.readText()) ?? "";
      if (now && now !== before) {
        await showHUD(`Copied ${now.length} characters`);
        return true;
      }
    }
    await showToast({ style: Toast.Style.Failure, title: "No text was copied", message: "Nothing was recognised." });
    return false;
  } catch (error) {
    await showToast({ style: Toast.Style.Failure, title: "Capture Text failed", message: explainError(error) });
    return false;
  }
}

/** Stop the active recording, or start a display recording. */
export async function toggleRecording(): Promise<"started" | "stopped" | "failed"> {
  let recording: boolean;
  try {
    recording = await isRecording();
  } catch (error) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Could not read ScreenflareX's state",
      message: explainError(error),
    });
    return "failed";
  }
  try {
    await closeMainWindow({ clearRootSearch: true });
    await fire(recording ? "stop-recording" : "record-display");
    await showHUD(recording ? "Stopping recording" : "Recording");
    return recording ? "stopped" : "started";
  } catch (error) {
    await showToast({ style: Toast.Style.Failure, title: "ScreenflareX failed", message: explainError(error) });
    return "failed";
  }
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
    return { ok: false, reason: "invalid", detail: String(error) };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, reason: "invalid", detail: String(error) };
  }
}

async function readDirs(dir: string): Promise<{ dirs: string[]; error?: string }> {
  if (!path.isAbsolute(dir)) return { dirs: [], error: `Folder path is not absolute: ${dir}` };
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return { dirs: entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(dir, entry.name)) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { dirs: [], error: `Folder not found: ${dir}` };
    return { dirs: [], error: `${String(error)} (${dir})` };
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

/** Opens the recording in the editor, revealing it in Finder if the app refuses. */
export async function openRecording(dir: string) {
  const bundle = bundleCandidates()[0] ?? DEFAULT_BUNDLE;
  try {
    await run("/usr/bin/open", ["-a", bundle, dir]);
  } catch {
    await showToast({ style: Toast.Style.Failure, title: "Could not open it", message: "Revealed in Finder" });
    await run("/usr/bin/open", ["-R", dir]);
  }
}
