export function parseLanguageList(output: string): string[] {
  return output
    .split(",")
    .map((entry) => entry.replace(/[()"\s]/g, ""))
    .filter((entry) => entry !== "" && entry !== "System");
}

export function selectLanguage(preferred: string[], available: string[]): string {
  for (const tag of preferred) {
    const parts = tag.split("-");
    const candidates = [tag, parts.length > 2 ? parts.slice(0, -1).join("-") : parts[0], parts[0]];
    for (const candidate of candidates) {
      const match = available.find((entry) => entry.toLowerCase() === candidate.toLowerCase());
      if (match) return match;
    }
  }
  return available.find((entry) => entry.toLowerCase() === "en") ?? available[0] ?? "en";
}
