export type FadeCurve = "linear" | "smooth" | "gentle";

export interface ScreenEffect {
  red: number;
  green: number;
  blue: number;
  brightness: number;
  contrast: number;
  shadows: number;
  blacks: number;
  temperature: number;
  strength: number;
}

export interface Schedule {
  id: string;
  name: string;
  enabled: boolean;
  days: boolean[];
  fadeInStart: string;
  fullStart: string;
  fadeOutStart: string;
  end: string;
  curve: FadeCurve;
  effect: ScreenEffect;
}

export interface AppSettings {
  enabled: boolean;
  runAtLogin: boolean;
  launchHidden: boolean;
  schedules: Schedule[];
}

export type EnginePhase = "idle" | "fade-in" | "active" | "fade-out" | "preview";

export interface EngineStatus {
  phase: EnginePhase;
  scheduleId: string | null;
  scheduleName: string | null;
  intensity: number;
  nextChange: string | null;
  displayCount: number;
  platformSupported: boolean;
  message: string | null;
  previewSecondsLeft: number | null;
}

export const DEFAULT_EFFECT: ScreenEffect = {
  red: 100,
  green: 58,
  blue: 36,
  brightness: -8,
  contrast: 4,
  shadows: 8,
  blacks: -4,
  temperature: 38,
  strength: 100,
};

export function createSchedule(index = 1): Schedule {
  return {
    id: crypto.randomUUID(),
    name: index === 1 ? "Evening red" : `New scene ${index}`,
    enabled: true,
    days: [true, true, true, true, true, true, true],
    fadeInStart: "19:30",
    fullStart: "20:15",
    fadeOutStart: "06:15",
    end: "07:00",
    curve: "smooth",
    effect: { ...DEFAULT_EFFECT },
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  enabled: true,
  runAtLogin: true,
  launchHidden: false,
  schedules: [createSchedule()],
};
