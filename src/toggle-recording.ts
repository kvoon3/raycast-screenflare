import { showHUD } from "@raycast/api";
import { capture, isRecording } from "./screenflare";

export default async function Command() {
  const recording = await isRecording().catch(() => false);
  if (await capture(recording ? "stop-recording" : "recording")) {
    await showHUD(recording ? "Recording stopped" : "Recording display");
  }
}
