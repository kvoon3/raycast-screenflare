import { closeMainWindow } from "@raycast/api";
import { captureText } from "./screenflare";

export default async function Command() {
  await closeMainWindow();
  await captureText();
}
