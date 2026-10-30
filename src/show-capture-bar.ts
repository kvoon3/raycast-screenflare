import { capture } from "./screenflare";

export default async function Command() {
  await capture("record-or-capture");
}
