import { showHUD, showToast, Toast } from "@raycast/api";
import { capture, explainError, isRecording } from "./screenflare";

export default async function Command() {
  let recording: boolean;
  try {
    recording = await isRecording();
  } catch (error) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Could not read Screenflare's state",
      message: explainError(error),
    });
    return;
  }
  if (await capture(recording ? "stopRecording" : "recordDisplay")) {
    await showHUD(recording ? "Stopping recording" : "Starting recording");
  }
}
