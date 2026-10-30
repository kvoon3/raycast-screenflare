import { Action, ActionPanel, Icon, Keyboard, List, showToast, Toast } from "@raycast/api";
import path from "node:path";
import { useEffect, useState } from "react";
import {
  capture,
  captureText,
  explainError,
  listRecordings,
  listScreenshots,
  openRecording,
  type Library,
  type Recording,
  type Screenshot,
} from "./screenflare";

type View = "recordings" | "screenshots";

const isView = (value: string): value is View => value === "recordings" || value === "screenshots";

export default function Command() {
  const [recordings, setRecordings] = useState<Library<Recording>>();
  const [screenshots, setScreenshots] = useState<Library<Screenshot>>();
  const [view, setView] = useState<View>("recordings");
  const [reloadToken, setReloadToken] = useState(0);
  const reload = () => setReloadToken((token) => token + 1);

  useEffect(() => {
    let active = true;
    setRecordings(undefined);
    setScreenshots(undefined);
    Promise.all([listRecordings(), listScreenshots()])
      .then(([recordingResult, screenshotResult]) => {
        if (!active) return;
        setRecordings(recordingResult);
        setScreenshots(screenshotResult);
        const problems = [...recordingResult.problems, ...screenshotResult.problems];
        if (problems.length > 0 && recordingResult.items.length + screenshotResult.items.length > 0) {
          void showToast({
            style: Toast.Style.Failure,
            title: `Skipped ${problems.length} unreadable capture${problems.length === 1 ? "" : "s"}`,
            message: problems[0],
          });
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message = explainError(error);
        setRecordings({ items: [], problems: [], error: message });
        setScreenshots({ items: [], problems: [], error: message });
        void showToast({ style: Toast.Style.Failure, title: "Could not read the library", message });
      });
    return () => {
      active = false;
    };
  }, [reloadToken]);

  const activeResult = view === "recordings" ? recordings : screenshots;

  return (
    <List
      isLoading={!recordings || !screenshots}
      searchBarAccessory={
        <List.Dropdown
          tooltip="Library"
          value={view}
          onChange={(value) => {
            if (isView(value)) setView(value);
          }}
        >
          <List.Dropdown.Item title="Recordings" value="recordings" />
          <List.Dropdown.Item title="Screenshots" value="screenshots" />
        </List.Dropdown>
      }
    >
      {view === "recordings"
        ? recordings?.items.map((r) => (
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
                  <Action.OpenWith path={path.join(r.dir, "screen.mov")} />
                  <CaptureActions onRefresh={reload} />
                </ActionPanel>
              }
            />
          ))
        : screenshots?.items.map((s) => (
            <List.Item
              key={s.dir}
              icon={{ source: s.thumb }}
              title={new Date(s.meta.createdAt).toLocaleString()}
              subtitle={humanize(s.meta.kind)}
              accessories={[
                { text: `${s.meta.pixelWidth}×${s.meta.pixelHeight}` },
                { date: new Date(s.meta.createdAt) },
              ]}
              actions={
                <ActionPanel>
                  <Action.Open target={s.image} title="Open Screenshot" icon={Icon.Image} />
                  <Action.ShowInFinder path={s.dir} />
                  <CaptureActions onRefresh={reload} />
                </ActionPanel>
              }
            />
          ))}
      <EmptyLibrary result={activeResult} view={view} />
    </List>
  );
}

function EmptyLibrary({ result, view }: { result?: Library<Recording> | Library<Screenshot>; view: View }) {
  if (!result || result.items.length > 0) return null;
  if (result.error) {
    return (
      <List.EmptyView
        icon={Icon.ExclamationMark}
        title={view === "recordings" ? "Could Not Read Recordings" : "Could Not Read Screenshots"}
        description={result.error}
      />
    );
  }
  if (result.problems.length > 0) {
    return (
      <List.EmptyView
        icon={Icon.ExclamationMark}
        title={view === "recordings" ? "No Readable Recordings" : "No Readable Screenshots"}
        description={result.problems.slice(0, 3).join("\n")}
      />
    );
  }
  return (
    <List.EmptyView
      title={view === "recordings" ? "No Recordings" : "No Screenshots"}
      description="Captures show up here once you make one."
    />
  );
}

function CaptureActions({ onRefresh }: { onRefresh: () => void }) {
  return (
    <ActionPanel.Section>
      <Action title="Capture Area Screenshot" icon={Icon.Crop} onAction={() => capture("capture-area")} />
      <Action title="Capture Fullscreen Screenshot" icon={Icon.Desktop} onAction={() => capture("capture-fullscreen")} />
      <Action title="Capture Window Screenshot" icon={Icon.AppWindow} onAction={() => capture("capture-window")} />
      <Action title="Scrolling Capture" icon={Icon.ArrowDown} onAction={() => capture("capture-scrolling")} />
      <Action title="Capture Text" icon={Icon.Text} onAction={captureText} />
      <Action title="Record Display" icon={Icon.Video} onAction={() => capture("record-display")} />
      <Action title="Show Capture Bar" icon={Icon.Window} onAction={() => capture("record-or-capture")} />
      <Action title="Screenshot History" icon={Icon.Image} onAction={() => capture("screenshot-history")} />
      <Action title="Recording History" icon={Icon.Video} onAction={() => capture("recording-history")} />
      <Action
        title="Refresh Library"
        icon={Icon.ArrowClockwise}
        shortcut={Keyboard.Shortcut.Common.Refresh}
        onAction={onRefresh}
      />
    </ActionPanel.Section>
  );
}

function humanize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatDuration(seconds: number) {
  const total = Math.round(seconds);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}
