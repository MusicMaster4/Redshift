import type { FadeCurve, Schedule } from "../types";

export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function timeToMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function scheduleOffsets(schedule: Pick<Schedule, "fadeInStart" | "fullStart" | "fadeOutStart" | "end">): number[] {
  const raw = [schedule.fadeInStart, schedule.fullStart, schedule.fadeOutStart, schedule.end].map(timeToMinutes);
  const offsets = [raw[0]];
  for (let index = 1; index < raw.length; index += 1) {
    let next = raw[index];
    while (next <= offsets[index - 1]) next += 24 * 60;
    offsets.push(next);
  }
  return offsets;
}

export function scheduleDuration(schedule: Schedule): number {
  const offsets = scheduleOffsets(schedule);
  return offsets[3] - offsets[0];
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours && rest) return `${hours}h ${rest}m`;
  if (hours) return `${hours}h`;
  return `${rest}m`;
}

export function curveValue(curve: FadeCurve, progress: number): number {
  const value = Math.min(1, Math.max(0, progress));
  if (curve === "linear") return value;
  if (curve === "gentle") return value * value * (3 - 2 * value);
  return 0.5 - Math.cos(Math.PI * value) / 2;
}

export function validateSchedule(schedule: Schedule): string | null {
  if (!schedule.name.trim()) return "Give this scene a name.";
  if (!schedule.days.some(Boolean)) return "Choose at least one day.";
  const offsets = scheduleOffsets(schedule);
  const duration = offsets[3] - offsets[0];
  if (duration > 24 * 60) return "A scene cannot last longer than 24 hours.";
  if (offsets[1] - offsets[0] < 1) return "Fade-in needs at least one minute.";
  if (offsets[3] - offsets[2] < 1) return "Fade-out needs at least one minute.";
  return null;
}
