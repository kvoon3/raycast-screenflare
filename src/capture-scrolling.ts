import { closeMainWindow } from "@raycast/api";
import { capture } from "./screenflare";

export default async function Command() {
  await closeMainWindow();
  await capture("scrolling");
}
