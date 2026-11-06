import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { appVersion, checkForUpdate, type AvailableUpdate } from "../lib/update";
import { useUpdater } from "./useUpdater";

vi.mock("../lib/api", () => ({ TAURI_RUNTIME: true }));
vi.mock("../lib/update", () => ({ appVersion: vi.fn(), checkForUpdate: vi.fn() }));

let updater: ReturnType<typeof useUpdater>;
let renderer: ReactTestRenderer;

function Harness() {
  updater = useUpdater();
  return null;
}

async function mount() {
  await act(async () => { renderer = create(createElement(Harness)); });
}

async function startupCheck() {
  await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  vi.mocked(appVersion).mockResolvedValue("1.0.0");
  vi.mocked(checkForUpdate).mockResolvedValue(null);
});

afterEach(() => {
  if (renderer) act(() => renderer.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("automatic update notifications", () => {
  test("stays idle while checking and when already up to date", async () => {
    let finish!: (update: null) => void;
    vi.mocked(checkForUpdate).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await mount();
    await startupCheck();
    expect(updater.status.kind).toBe("idle");
    expect(checkForUpdate).toHaveBeenCalledOnce();
    await act(async () => { finish(null); });
    expect(updater.status.kind).toBe("idle");
  });

  test("stays silent when the update server is unavailable", async () => {
    vi.mocked(checkForUpdate).mockRejectedValue(new Error("Offline"));
    await mount();
    await startupCheck();
    expect(updater.status.kind).toBe("idle");
  });

  test("only announces an update returned by the version and channel checks", async () => {
    const update: AvailableUpdate = { version: "1.0.1", notes: "Fixes", install: vi.fn() };
    vi.mocked(checkForUpdate).mockResolvedValue(update);
    await mount();
    await startupCheck();
    expect(updater.status).toEqual({ kind: "available", update });
    act(() => updater.dismiss());
    expect(updater.status.kind).toBe("idle");
  });

  test("handles a failed version lookup without an unhandled rejection", async () => {
    vi.mocked(appVersion).mockRejectedValue(new Error("Version unavailable"));
    await mount();
    await startupCheck();
    expect(updater.status.kind).toBe("idle");
  });
});

describe("explicit update actions", () => {
  test("still reports the result of a manual check", async () => {
    await mount();
    await act(async () => { updater.check(); });
    expect(updater.status.kind).toBe("current");
  });

  test("reports a manual error and allows a retry", async () => {
    vi.mocked(checkForUpdate).mockRejectedValueOnce(new Error("Offline"));
    await mount();
    await act(async () => { updater.check(); });
    expect(updater.status).toEqual({ kind: "failed", message: "Offline" });
    await act(async () => { updater.check(); });
    expect(updater.status.kind).toBe("current");
  });

  test("does not run simultaneous checks", async () => {
    let finish!: (update: null) => void;
    vi.mocked(checkForUpdate).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await mount();
    act(() => { updater.check(); updater.check(); });
    await startupCheck();
    expect(checkForUpdate).toHaveBeenCalledOnce();
    await act(async () => { finish(null); });
    expect(updater.status.kind).toBe("current");
  });

  test("prevents duplicate installs and keeps installation progress open", async () => {
    let finish!: () => void;
    const install = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    vi.mocked(checkForUpdate).mockResolvedValue({ version: "1.0.1", notes: null, install });
    await mount();
    await act(async () => { updater.check(); });
    act(() => { updater.install(); updater.dismiss(); updater.install(); updater.check(); });
    await startupCheck();
    expect(updater.status.kind).toBe("installing");
    expect(install).toHaveBeenCalledOnce();
    expect(checkForUpdate).toHaveBeenCalledOnce();
    await act(async () => { finish(); });
  });
});
