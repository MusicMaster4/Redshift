import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AlertTriangle,
  ArrowDownToLine,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  Laptop,
  Minus,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useUpdater } from "./hooks/useUpdater";
import {
  engineStatus,
  loadSettings,
  previewSchedule,
  resetScreen,
  saveSettings,
  stopPreview,
  TAURI_RUNTIME,
} from "./lib/api";
import { DAY_LABELS, formatDuration, scheduleDuration, validateSchedule } from "./lib/schedule";
import {
  createSchedule,
  DEFAULT_SETTINGS,
  type AppSettings,
  type EngineStatus,
  type FadeCurve,
  type Schedule,
  type ScreenEffect,
} from "./types";

const appWindow = TAURI_RUNTIME ? getCurrentWindow() : null;

const IDLE_STATUS: EngineStatus = {
  phase: "idle",
  scheduleId: null,
  scheduleName: null,
  intensity: 0,
  nextChange: null,
  displayCount: 0,
  platformSupported: true,
  message: null,
  previewSecondsLeft: null,
};

type Toast = { id: number; tone: "success" | "warning"; text: string };

function cloneSettings(settings: AppSettings): AppSettings {
  return structuredClone(settings);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      className={`toggle ${checked ? "is-on" : ""}`}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

function EffectSlider({
  label,
  value,
  min = -100,
  max = 100,
  color = "var(--accent)",
  suffix = "%",
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  color?: string;
  suffix?: string;
  hint?: string;
  onChange: (value: number) => void;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className="slider-row">
      <span className="slider-label">
        <span>{label}</span>
        {hint && <span className="slider-hint">{hint}</span>}
      </span>
      <span className="slider-input-wrap">
        <input
          aria-label={label}
          type="range"
          min={min}
          max={max}
          step={1}
          value={value}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
          style={{ "--range-fill": `${fill}%`, "--range-color": color } as React.CSSProperties}
        />
        <span className="slider-value">{value > 0 && min < 0 ? "+" : ""}{value}{suffix}</span>
      </span>
    </label>
  );
}

function ScreenPreview({ effect, intensity }: { effect: ScreenEffect; intensity: number }) {
  const master = clamp((effect.strength / 100) * intensity, 0, 1);
  const warmth = effect.temperature / 100;
  const warmRed = clamp(effect.red / 100 + Math.max(0, warmth) * 0.12, 0, 1.2);
  const warmBlue = clamp(effect.blue / 100 + Math.max(0, -warmth) * 0.12, 0, 1.2);
  const green = effect.green / 100;
  const red = 1 + (warmRed - 1) * master;
  const greenMatrix = 1 + (green - 1) * master;
  const blue = 1 + (warmBlue - 1) * master;
  const contrast = 1 + (effect.contrast / 100) * master * 0.75;
  const slope = clamp(contrast, 0.25, 1.75);
  const intercept = (1 - slope) / 2 + (effect.brightness / 100) * master * 0.24;
  const filterId = `preview-${Math.round(red * 100)}-${Math.round(greenMatrix * 100)}-${Math.round(blue * 100)}`;

  return (
    <div className="screen-preview" aria-label="Live color preview">
      <div className="preview-topbar">
        <span>Preview</span>
        <span>{Math.round(master * 100)}%</span>
      </div>
      <svg viewBox="0 0 760 330" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Stylized landscape showing the selected screen effect">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#648bc7" />
            <stop offset="0.6" stopColor="#e9a972" />
            <stop offset="1" stopColor="#f0c586" />
          </linearGradient>
          <linearGradient id="ground" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#42524c" />
            <stop offset="1" stopColor="#121b1b" />
          </linearGradient>
          <filter id={filterId} colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values={`${red} 0 0 0 0  0 ${greenMatrix} 0 0 0  0 0 ${blue} 0 0  0 0 0 1 0`} />
            <feComponentTransfer>
              <feFuncR type="linear" slope={slope} intercept={intercept} />
              <feFuncG type="linear" slope={slope} intercept={intercept} />
              <feFuncB type="linear" slope={slope} intercept={intercept} />
            </feComponentTransfer>
          </filter>
          <filter id="soft"><feGaussianBlur stdDeviation="10" /></filter>
        </defs>
        <g filter={`url(#${filterId})`}>
          <rect width="760" height="330" fill="url(#sky)" />
          <circle cx="580" cy="90" r="45" fill="#ffe5ad" opacity=".86" />
          <circle cx="580" cy="90" r="64" fill="#ffc270" opacity=".22" filter="url(#soft)" />
          <path d="M0 210 L105 128 L178 190 L273 82 L410 210 Z" fill="#344456" opacity=".95" />
          <path d="M148 210 L270 82 L411 210 Z" fill="#5b6973" opacity=".9" />
          <path d="M232 122 L271 82 L314 128 L283 120 L267 132 L251 118 Z" fill="#e8e1d4" opacity=".9" />
          <path d="M0 208 C115 184 205 239 312 213 C431 184 516 197 760 172 L760 330 L0 330 Z" fill="url(#ground)" />
          <path d="M0 272 C142 246 251 282 365 251 C484 219 600 228 760 211" fill="none" stroke="#75846d" strokeWidth="5" opacity=".38" />
          <g fill="#172322">
            <path d="M84 229 l14 -58 l14 58 z M91 211 l7 -72 l8 72 z" />
            <path d="M670 214 l18 -76 l18 76 z M680 191 l8 -91 l9 91 z" />
            <path d="M620 224 l12 -54 l14 54 z M626 205 l7 -65 l7 65 z" />
          </g>
        </g>
      </svg>
    </div>
  );
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="time-field">
      <span>
        <span className="time-label">{label}</span>
        <input type="time" value={value} onChange={(event) => onChange(event.currentTarget.value)} />
      </span>
    </label>
  );
}

function FadeCurveSelect({ value, onChange }: { value: FadeCurve; onChange: (value: FadeCurve) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const options: Array<{ value: FadeCurve; label: string }> = [
    { value: "smooth", label: "Smooth" },
    { value: "gentle", label: "Gentle" },
    { value: "linear", label: "Linear" },
  ];
  const selectedLabel = options.find((option) => option.value === value)?.label ?? "Smooth";

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="fade-curve-picker" ref={root}>
      <button
        className="fade-curve-trigger"
        type="button"
        role="combobox"
        aria-label={`Fade curve: ${selectedLabel}`}
        aria-expanded={open}
        aria-controls="fade-curve-options"
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selectedLabel}</span><ChevronDown size={15} />
      </button>
      {open && (
        <div className="fade-curve-menu" id="fade-curve-options" role="listbox" aria-label="Fade curve">
          {options.map((option) => (
            <button
              className="fade-curve-option"
              type="button"
              role="option"
              aria-selected={option.value === value}
              key={option.value}
              onClick={() => { onChange(option.value); setOpen(false); }}
            >
              <span>{option.label}</span>{option.value === value && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UpdateDialog({ updater }: { updater: ReturnType<typeof useUpdater> }) {
  if (updater.status.kind === "idle") return null;
  const status = updater.status;
  return (
    <div className="modal-backdrop" onMouseDown={updater.dismiss}>
      <section className="modal update-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="icon-button modal-close" type="button" onClick={updater.dismiss} aria-label="Close"><X size={17} /></button>
        <div className="modal-mark"><ArrowDownToLine size={23} /></div>
        {status.kind === "checking" && <><h2>Checking for updates</h2><p>Channel: {updater.channel === "testing" ? "beta" : "stable"}.</p><div className="indeterminate" /></>}
        {status.kind === "current" && <><h2>Up to date</h2><p>Version {updater.version}, {updater.channel === "testing" ? "beta" : "stable"} channel.</p><button className="primary-button wide" onClick={updater.dismiss}>Done</button></>}
        {status.kind === "available" && <><h2>Version {status.update.version}</h2><p>Your schedules will be kept.</p>{status.update.notes && <div className="release-notes">{status.update.notes}</div>}<button className="primary-button wide" onClick={updater.install}><ArrowDownToLine size={16} />Install</button></>}
        {status.kind === "installing" && <><h2>Installing {status.version}</h2><p>Redshift will restart when the update is ready.</p><div className="download-track"><span style={{ width: `${Math.round((status.fraction ?? 0.12) * 100)}%` }} /></div></>}
        {status.kind === "failed" && <><h2>Could not check</h2><p>{status.message}</p><button className="secondary-button wide" onClick={updater.check}><RefreshCw size={15} />Try again</button></>}
      </section>
    </div>
  );
}

function SettingsDialog({ settings, onClose, onReset, updater }: {
  settings: AppSettings;
  onClose: () => void;
  onReset: () => void;
  updater: ReturnType<typeof useUpdater>;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal settings-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-heading"><h2>Settings</h2><button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="setting-row"><div><strong>Background startup</strong><span>Starts quietly after sign-in so schedules always run.</span></div><span className="setting-value">Always on</span></div>
        <div className="setting-row"><div><strong>Updates</strong><span>{updater.channel === "testing" ? "Beta" : "Stable"} channel, version {updater.version}.</span></div><button className="text-button" type="button" onClick={updater.check}>Check</button></div>
        <div className="setting-row danger-row"><div><strong>Restore display</strong><span>Pause Redshift and restore the original color.</span></div><button className="secondary-button" type="button" onClick={onReset}><RotateCcw size={15} />Restore</button></div>
        <div className="settings-note"><CircleHelp size={16} /><span>Closing the window leaves Redshift running in the tray. Use Quit in the tray menu to stop it.</span></div>
      </section>
    </div>
  );
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(() => cloneSettings(DEFAULT_SETTINGS));
  const [savedSettings, setSavedSettings] = useState<AppSettings>(() => cloneSettings(DEFAULT_SETTINGS));
  const [selectedId, setSelectedId] = useState(DEFAULT_SETTINGS.schedules[0].id);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<EngineStatus>(IDLE_STATUS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const updater = useUpdater();
  const toastId = useRef(0);
  const moreMenu = useRef<HTMLDivElement>(null);

  const notify = useCallback((text: string, tone: Toast["tone"] = "success") => {
    const id = ++toastId.current;
    setToasts((items) => [...items, { id, tone, text }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 3200);
  }, []);

  useEffect(() => {
    void loadSettings().then((loadedSettings) => {
      const normalized = loadedSettings.schedules.length ? loadedSettings : cloneSettings(DEFAULT_SETTINGS);
      setSettings(cloneSettings(normalized));
      setSavedSettings(cloneSettings(normalized));
      setSelectedId(normalized.schedules[0].id);
      setLoaded(true);
    }).catch(() => {
      setLoaded(true);
      notify("Settings could not be loaded. Defaults are active.", "warning");
    });
  }, [notify]);

  useEffect(() => {
    const poll = async () => {
      try { setStatus(await engineStatus()); } catch { /* keep the last good status */ }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!moreOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!moreMenu.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [moreOpen]);

  const selected = settings.schedules.find((schedule) => schedule.id === selectedId) ?? settings.schedules[0];
  const dirty = JSON.stringify(settings) !== JSON.stringify(savedSettings);
  const validation = selected ? validateSchedule(selected) : "Add a scene to continue.";
  const activeIntensity = status.scheduleId === selected?.id || status.phase === "preview" ? status.intensity : 1;

  const updateSchedule = useCallback((edit: (current: Schedule) => Schedule) => {
    setSettings((current) => ({
      ...current,
      schedules: current.schedules.map((schedule) => schedule.id === selectedId ? edit(schedule) : schedule),
    }));
  }, [selectedId]);

  const updateEffect = useCallback((key: keyof ScreenEffect, value: number) => {
    updateSchedule((schedule) => ({ ...schedule, effect: { ...schedule.effect, [key]: value } }));
  }, [updateSchedule]);

  const addSchedule = () => {
    const schedule = createSchedule(settings.schedules.length + 1);
    setSettings((current) => ({ ...current, schedules: [...current.schedules, schedule] }));
    setSelectedId(schedule.id);
  };

  const duplicateSchedule = () => {
    if (!selected) return;
    const copy = { ...structuredClone(selected), id: crypto.randomUUID(), name: `${selected.name} copy` };
    setSettings((current) => ({ ...current, schedules: [...current.schedules, copy] }));
    setSelectedId(copy.id);
    setMoreOpen(false);
  };

  const deleteSchedule = () => {
    if (!selected || settings.schedules.length === 1) return;
    const remaining = settings.schedules.filter((schedule) => schedule.id !== selected.id);
    setSettings((current) => ({ ...current, schedules: remaining }));
    setSelectedId(remaining[0].id);
    setMoreOpen(false);
  };

  const commit = async () => {
    const invalid = settings.schedules.map(validateSchedule).find(Boolean);
    if (invalid) return notify(invalid, "warning");
    try {
      const saved = await saveSettings(settings);
      setSettings(cloneSettings(saved));
      setSavedSettings(cloneSettings(saved));
      notify("Saved.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not save settings.", "warning");
    }
  };

  const startPreview = async () => {
    if (!selected || validation) return notify(validation ?? "This scene is not ready.", "warning");
    await previewSchedule(selected, 15);
    notify("Preview started.");
  };

  const cancelPreview = async () => {
    await stopPreview();
    setStatus((current) => ({ ...current, phase: "idle", intensity: 0, previewSecondsLeft: null }));
  };

  const reset = async () => {
    const resetSettings = await resetScreen();
    setSettings(cloneSettings(resetSettings));
    setSavedSettings(cloneSettings(resetSettings));
    notify("Display restored. Schedule paused.");
  };

  const masterToggle = (enabled: boolean) => {
    setSettings((current) => ({ ...current, enabled }));
  };

  const statusText = useMemo(() => {
    if (!settings.enabled) return "Paused";
    if (status.phase === "preview") return `Preview ${status.previewSecondsLeft ?? 0}s`;
    if (status.phase === "active") return `${status.scheduleName ?? "Scene"} active`;
    if (status.phase === "fade-in") return `Fading in ${status.scheduleName ?? "scene"}`;
    if (status.phase === "fade-out") return `Fading out ${status.scheduleName ?? "scene"}`;
    return "Scheduled";
  }, [settings.enabled, status]);

  if (!loaded) {
    return <div className="loading-screen"><img src="/app-icon.png" alt="" /><span>Redshift</span><div className="indeterminate" /></div>;
  }

  if (!selected) return null;

  return (
    <div className="app-shell">
      <header className="titlebar" data-tauri-drag-region>
        <div className="titlebar-brand" data-tauri-drag-region><img src="/app-icon.png" alt="" /><span>Redshift</span></div>
        <div className="titlebar-status" data-tauri-drag-region><span className={`status-orb ${settings.enabled ? "is-live" : ""}`} />{statusText}</div>
        <div className="window-controls">
          <button type="button" aria-label="Minimize" onClick={() => appWindow && void appWindow.minimize()}><Minus size={15} /></button>
          <button type="button" aria-label="Maximize" onClick={() => appWindow && void appWindow.toggleMaximize()}><span className="maximize-icon" /></button>
          <button className="window-close" type="button" aria-label="Close" onClick={() => appWindow && void appWindow.close()}><X size={15} /></button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <section className="schedule-control">
            <div><strong>Schedule</strong><span>{settings.enabled ? (status.nextChange ? `Next change at ${status.nextChange}` : "Waiting for next scene") : "Paused"}</span></div>
            <Toggle checked={settings.enabled} onChange={masterToggle} label="Enable Redshift" />
          </section>

          <div className="sidebar-section-heading"><span>Scenes</span><button type="button" onClick={addSchedule} aria-label="Add scene"><Plus size={16} /></button></div>
          <nav className="scene-list" aria-label="Scenes">
            {settings.schedules.map((schedule) => (
              <button
                type="button"
                className={`scene-item ${schedule.id === selected.id ? "is-selected" : ""}`}
                key={schedule.id}
                onClick={() => setSelectedId(schedule.id)}
              >
                <span className="scene-copy"><strong>{schedule.name}</strong><small>{schedule.fadeInStart} – {schedule.end}</small></span>
                <span className={`scene-state ${schedule.enabled ? "is-on" : ""}`} />
              </button>
            ))}
          </nav>

          <div className="sidebar-spacer" />
          <button className="sidebar-link" type="button" onClick={() => setSettingsOpen(true)}><Settings size={17} /><span>Settings</span></button>
          <button className={`sidebar-link ${updater.status.kind === "available" ? "has-update" : ""}`} type="button" onClick={updater.check}><ArrowDownToLine size={17} /><span>Updates</span><small>{updater.channel === "testing" ? "Beta" : `v${updater.version}`}</small></button>
          <div className="platform-note"><Laptop size={14} /><span>{TAURI_RUNTIME ? `${status.displayCount || 1} display${status.displayCount === 1 ? "" : "s"} connected` : "Design preview"}</span></div>
        </aside>

        <main className="editor">
          <div className="editor-heading">
            <div className="scene-title-wrap">
              <input
                className="scene-title"
                aria-label="Scene name"
                value={selected.name}
                onChange={(event) => updateSchedule((schedule) => ({ ...schedule, name: event.currentTarget.value }))}
              />
            </div>
            <div className="editor-actions">
              <span className="enabled-label">{selected.enabled ? "Enabled" : "Disabled"}</span>
              <Toggle checked={selected.enabled} onChange={(enabled) => updateSchedule((schedule) => ({ ...schedule, enabled }))} label="Enable this scene" />
              <div className="more-wrap" ref={moreMenu}>
                <button className="icon-button" type="button" aria-label="More scene actions" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}><MoreHorizontal size={19} /></button>
                {moreOpen && <div className="context-menu" role="menu"><button type="button" role="menuitem" onClick={duplicateSchedule}><Copy size={14} />Duplicate</button><button type="button" role="menuitem" className="danger" disabled={settings.schedules.length === 1} onClick={deleteSchedule}><Trash2 size={14} />Delete</button></div>}
              </div>
            </div>
          </div>

          <div className="editor-scroll">
            <section className="top-grid">
              <ScreenPreview effect={selected.effect} intensity={activeIntensity} />
              <div className="schedule-summary">
                <div className="section-heading"><h2>Repeats</h2><span>Select active days</span></div>
                <div className="day-picker" aria-label="Active days">
                  {DAY_LABELS.map((day, index) => (
                    <button
                      type="button"
                      key={day}
                      className={selected.days[index] ? "is-selected" : ""}
                      aria-pressed={selected.days[index]}
                      onClick={() => updateSchedule((schedule) => ({ ...schedule, days: schedule.days.map((active, dayIndex) => dayIndex === index ? !active : active) }))}
                    >{day.slice(0, 1)}</button>
                  ))}
                </div>
                <div className="duration-row"><span>Scene duration</span><strong>{formatDuration(scheduleDuration(selected))}</strong></div>
                <div className="curve-select">
                  <span>Fade curve</span>
                  <FadeCurveSelect value={selected.curve} onChange={(curve) => updateSchedule((schedule) => ({ ...schedule, curve }))} />
                </div>
              </div>
            </section>

            <section className="timeline-card">
              <div className="section-heading is-split"><div><h2>Schedule</h2><span>Fade in, hold, fade out.</span></div><span className="timeline-duration">{formatDuration(scheduleDuration(selected))}</span></div>
              <div className="timeline-track" aria-hidden="true"><span className="fade-in-segment" /><span className="hold-segment" /><span className="fade-out-segment" /><i className="track-dot dot-one" /><i className="track-dot dot-two" /><i className="track-dot dot-three" /><i className="track-dot dot-four" /></div>
              <div className="time-fields">
                <TimeField label="Fade in" value={selected.fadeInStart} onChange={(fadeInStart) => updateSchedule((schedule) => ({ ...schedule, fadeInStart }))} />
                <TimeField label="Full effect" value={selected.fullStart} onChange={(fullStart) => updateSchedule((schedule) => ({ ...schedule, fullStart }))} />
                <TimeField label="Fade out" value={selected.fadeOutStart} onChange={(fadeOutStart) => updateSchedule((schedule) => ({ ...schedule, fadeOutStart }))} />
                <TimeField label="Off" value={selected.end} onChange={(end) => updateSchedule((schedule) => ({ ...schedule, end }))} />
              </div>
              {validation && <div className="validation-message"><AlertTriangle size={15} />{validation}</div>}
            </section>

            <section className="controls-grid">
              <div className="control-card channel-card">
                <div className="control-heading"><h2>Channels</h2><span>Limit each color channel.</span></div>
                <EffectSlider label="Red" min={0} value={selected.effect.red} color="#ef3d42" onChange={(value) => updateEffect("red", value)} />
                <EffectSlider label="Green" min={0} value={selected.effect.green} color="#43c487" onChange={(value) => updateEffect("green", value)} />
                <EffectSlider label="Blue" min={0} value={selected.effect.blue} color="#5792ff" onChange={(value) => updateEffect("blue", value)} />
                <p className="control-footnote">Set green and blue to 0% for a red-only display.</p>
              </div>

              <div className="control-card">
                <div className="control-heading"><h2>Light</h2><span>Overall output.</span></div>
                <EffectSlider label="Brightness" value={selected.effect.brightness} onChange={(value) => updateEffect("brightness", value)} />
                <EffectSlider label="Contrast" value={selected.effect.contrast} onChange={(value) => updateEffect("contrast", value)} />
                <EffectSlider label="Strength" min={0} value={selected.effect.strength} hint="Master" onChange={(value) => updateEffect("strength", value)} />
              </div>

              <div className="control-card">
                <div className="control-heading"><h2>Dark tones</h2><span>Shape the lower range.</span></div>
                <EffectSlider label="Shadows" value={selected.effect.shadows} onChange={(value) => updateEffect("shadows", value)} />
                <EffectSlider label="Black point" value={selected.effect.blacks} onChange={(value) => updateEffect("blacks", value)} />
                <p className="control-footnote">Negative values deepen dark areas. Positive values lift detail.</p>
              </div>

              <div className="control-card temperature-card">
                <div className="control-heading"><h2>Temperature</h2><span>Cool or warm the display.</span></div>
                <EffectSlider label="Temperature" value={selected.effect.temperature} color="#aaa8a6" suffix="" onChange={(value) => updateEffect("temperature", value)} />
                <div className="temperature-labels"><span>Cooler</span><span>Neutral</span><span>Warmer</span></div>
                <div className="temperature-swatch" style={{ "--temperature": `${(selected.effect.temperature + 100) / 2}%` } as React.CSSProperties}><span /></div>
              </div>
            </section>
          </div>

          <footer className="editor-footer">
            <div>
              {status.phase === "preview" ? <button className="preview-active-button" type="button" onClick={cancelPreview}><Pause size={15} />Stop <span>{status.previewSecondsLeft ?? 0}s</span></button> : <button className="secondary-button" type="button" onClick={startPreview} disabled={Boolean(validation)}><Play size={15} />Preview 15s</button>}
              <span className="safety-copy">3s in, 9s full, 3s out. Always resets.</span>
            </div>
            <button className="primary-button" type="button" onClick={commit} disabled={!dirty || Boolean(validation)}>{dirty ? <>Save</> : <><Check size={16} />Saved</>}</button>
          </footer>
        </main>
      </div>

      <div className="toast-stack" aria-live="polite">{toasts.map((toast) => <div key={toast.id} className={`toast ${toast.tone}`}><span>{toast.tone === "success" ? <Check size={15} /> : <AlertTriangle size={15} />}</span>{toast.text}</div>)}</div>
      {settingsOpen && <SettingsDialog settings={settings} onClose={() => setSettingsOpen(false)} onReset={reset} updater={updater} />}
      <UpdateDialog updater={updater} />
    </div>
  );
}
