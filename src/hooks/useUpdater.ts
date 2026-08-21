import { useCallback, useEffect, useRef, useState } from "react";

import { TAURI_RUNTIME } from "../lib/api";
import { appVersion, checkForUpdate, type AvailableUpdate } from "../lib/update";
import { channelOf, type Channel } from "../lib/version";

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; update: AvailableUpdate }
  | { kind: "installing"; version: string; fraction: number | null }
  | { kind: "failed"; message: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "Update check failed.");
}

export function useUpdater() {
  const [version, setVersion] = useState("1.0.0");
  const [status, setStatus] = useState<UpdateStatus>({ kind: "idle" });
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    if (!TAURI_RUNTIME) return;
    void appVersion().then(setVersion);
  }, []);

  const runCheck = useCallback(async (quiet = false) => {
    if (!TAURI_RUNTIME) {
      if (!quiet) setStatus({ kind: "current" });
      return;
    }
    if (!quiet) setStatus({ kind: "checking" });
    try {
      const update = await checkForUpdate();
      setStatus(update ? { kind: "available", update } : { kind: "current" });
    } catch (error) {
      if (!quiet) setStatus({ kind: "failed", message: errorMessage(error) });
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void runCheck(true), 1600);
    return () => window.clearTimeout(timer);
  }, [runCheck]);

  const install = useCallback(async () => {
    const current = statusRef.current;
    if (current.kind !== "available") return;
    setStatus({ kind: "installing", version: current.update.version, fraction: null });
    try {
      await current.update.install((fraction) => {
        setStatus((previous) => previous.kind === "installing" ? { ...previous, fraction } : previous);
      });
    } catch (error) {
      setStatus({ kind: "failed", message: errorMessage(error) });
    }
  }, []);

  return {
    version,
    channel: channelOf(version) as Channel,
    status,
    check: () => void runCheck(false),
    install: () => void install(),
    dismiss: () => setStatus({ kind: "idle" }),
  };
}
