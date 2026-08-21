import { invoke } from "@tauri-apps/api/core";

import { DEFAULT_SETTINGS, type AppSettings, type EngineStatus, type Schedule } from "../types";

export const TAURI_RUNTIME = "__TAURI_INTERNALS__" in window;

const WEB_SETTINGS_KEY = "redshift.settings.v1";

function webLoad(): AppSettings {
  try {
    const saved = localStorage.getItem(WEB_SETTINGS_KEY);
    return saved ? (JSON.parse(saved) as AppSettings) : structuredClone(DEFAULT_SETTINGS);
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export async function loadSettings(): Promise<AppSettings> {
  return TAURI_RUNTIME ? invoke<AppSettings>("load_settings") : webLoad();
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  if (TAURI_RUNTIME) return invoke<AppSettings>("save_settings", { settings });
  localStorage.setItem(WEB_SETTINGS_KEY, JSON.stringify(settings));
  return settings;
}

export async function previewSchedule(schedule: Schedule, seconds = 15): Promise<void> {
  if (TAURI_RUNTIME) await invoke("preview_schedule", { schedule, seconds });
}

export async function stopPreview(): Promise<void> {
  if (TAURI_RUNTIME) await invoke("stop_preview");
}

export async function resetScreen(): Promise<AppSettings> {
  if (TAURI_RUNTIME) return invoke<AppSettings>("reset_screen");
  const settings = webLoad();
  const next = { ...settings, enabled: false };
  localStorage.setItem(WEB_SETTINGS_KEY, JSON.stringify(next));
  return next;
}

export async function engineStatus(): Promise<EngineStatus> {
  if (TAURI_RUNTIME) return invoke<EngineStatus>("engine_status");
  return {
    phase: "idle",
    scheduleId: null,
    scheduleName: null,
    intensity: 0,
    nextChange: null,
    displayCount: 1,
    platformSupported: true,
    message: "Browser preview mode",
    previewSecondsLeft: null,
  };
}
