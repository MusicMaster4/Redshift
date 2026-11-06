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
  const checkingRef = useRef(false);

  const changeStatus = useCallback((next: UpdateStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  useEffect(() => {
    if (!TAURI_RUNTIME) return;
    void appVersion().then(setVersion).catch(() => { /* A failed version lookup must stay silent. */ });
  }, []);

  const runCheck = useCallback(async (quiet = false) => {
    if (checkingRef.current || statusRef.current.kind === "installing") return;
    if (!TAURI_RUNTIME) {
      if (!quiet) changeStatus({ kind: "current" });
      return;
    }
    checkingRef.current = true;
    if (!quiet) changeStatus({ kind: "checking" });
    try {
      const update = await checkForUpdate();
      if (update) changeStatus({ kind: "available", update });
      else if (!quiet) changeStatus({ kind: "current" });
    } catch (error) {
      if (!quiet) changeStatus({ kind: "failed", message: errorMessage(error) });
    } finally {
      checkingRef.current = false;
    }
  }, [changeStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => void runCheck(true), 1600);
    return () => window.clearTimeout(timer);
  }, [runCheck]);

  const install = useCallback(async () => {
    const current = statusRef.current;
    if (current.kind !== "available") return;
    changeStatus({ kind: "installing", version: current.update.version, fraction: null });
    try {
      await current.update.install((fraction) => {
        setStatus((previous) => previous.kind === "installing" ? { ...previous, fraction } : previous);
      });
    } catch (error) {
      changeStatus({ kind: "failed", message: errorMessage(error) });
    }
  }, [changeStatus]);

  return {
    version,
    channel: channelOf(version) as Channel,
    status,
    check: () => void runCheck(false),
    install: () => void install(),
    dismiss: () => {
      if (statusRef.current.kind !== "installing") changeStatus({ kind: "idle" });
    },
  };
}
