import { Action, ActionPanel, Icon, List, getPreferenceValues } from "@raycast/api";
import { execFile } from "node:child_process";
import { useEffect, useState } from "react";
import {
  capture,
  captureText,
  listRecordings,
  listScreenshots,
  openRecording,
  type Recording,
  type Screenshot,
} from "./screenflare";

const open = (file: string) => new Promise<void>((ok, fail) => execFile("open", [file], (e) => (e ? fail(e) : ok())));

export default function Command() {
  const prefs = getPreferenceValues<{ defaultView?: string }>();
  const [recordings, setRecordings] = useState<Recording[]>();
  const [screenshots, setScreenshots] = useState<Screenshot[]>();
  const [view, setView] = useState(prefs.defaultView === "screenshots" ? "screenshots" : "recordings");

  useEffect(() => {
    listRecordings().then(setRecordings);
    listScreenshots().then(setScreenshots);
  }, []);

  return (
    <List
      isLoading={!recordings || !screenshots}
      searchBarAccessory={
        <List.Dropdown tooltip="Library" value={view} onChange={setView}>
          <List.Dropdown.Item title="Recordings" value="recordings" />
          <List.Dropdown.Item title="Screenshots" value="screenshots" />
        </List.Dropdown>
      }
    >
      {view === "recordings"
        ? recordings?.map((r) => (
            <List.Item
              key={r.dir}
              icon={{ source: `${r.dir}/thumbnail.png` }}
              title={r.name}
              subtitle={r.meta.sourceName}
              accessories={[
                { text: formatDuration(r.meta.duration) },
                { text: `${r.meta.pixelWidth}×${r.meta.pixelHeight}` },
                { date: new Date(r.meta.createdAt) },
              ]}
              actions={
                <ActionPanel>
                  <Action title="Open in Screenflare" icon={Icon.Pencil} onAction={() => openRecording(r.dir)} />
                  <Action.ShowInFinder path={r.dir} />
                  <Action.OpenWith path={r.dir} />
                  <CaptureActions />
                </ActionPanel>
              }
            />
          ))
        : screenshots?.map((s) => (
            <List.Item
              key={s.dir}
              icon={{ source: s.thumb }}
              title={new Date(s.meta.createdAt).toLocaleString()}
              subtitle={s.meta.kind}
              accessories={[
                { text: `${s.meta.pixelWidth}×${s.meta.pixelHeight}` },
                { date: new Date(s.meta.createdAt) },
              ]}
              actions={
                <ActionPanel>
                  <Action title="Open Screenshot" icon={Icon.Image} onAction={() => open(s.image)} />
                  <Action.ShowInFinder path={s.dir} />
                  <CaptureActions />
                </ActionPanel>
              }
            />
          ))}
      {libraryIsEmpty(view, recordings, screenshots) && (
        <List.EmptyView
          title={view === "recordings" ? "No Recordings" : "No Screenshots"}
          description="Captures show up here once you make one."
        />
      )}
    </List>
  );
}

/** Screenflare writes thumbnails but the full-quality PNG is a separate export elsewhere; open what exists. */
const libraryIsEmpty = (view: string, r?: Recording[], s?: Screenshot[]) =>
  (view === "recordings" ? r : s)?.length === 0;

function CaptureActions() {
  return (
    <ActionPanel.Section>
      <Action title="Capture Area Screenshot" icon={Icon.Crop} onAction={() => capture("area")} />
      <Action title="Capture Fullscreen Screenshot" icon={Icon.Desktop} onAction={() => capture("screenshot")} />
      <Action title="Capture Text" icon={Icon.Text} onAction={captureText} />
      <Action title="Record Display" icon={Icon.Video} onAction={() => capture("recording")} />
      <Action title="Show Capture Bar" icon={Icon.Window} onAction={() => capture("bar")} />
      <Action title="Screenshot History" icon={Icon.Image} onAction={() => capture("history")} />
      <Action title="Recording History" icon={Icon.Video} onAction={() => capture("recording-history")} />
    </ActionPanel.Section>
  );
}

function formatDuration(seconds: number) {
  const total = Math.round(seconds);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}
