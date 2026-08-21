use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use chrono::{Local, Timelike};

use crate::{
    display,
    model::{AppSettings, EnginePhase, EngineStatus, Schedule, ScreenEffect},
    schedule,
};

struct Preview {
    schedule: Schedule,
    started: Instant,
    until: Instant,
}

fn preview_intensity(elapsed: Duration, remaining: Duration) -> f32 {
    let fade_seconds = 3.0_f32;
    let linear = (elapsed.as_secs_f32() / fade_seconds)
        .min(remaining.as_secs_f32() / fade_seconds)
        .clamp(0.0, 1.0);
    0.5 - (std::f32::consts::PI * linear).cos() / 2.0
}

fn until_next_minute() -> Duration {
    let now = Local::now();
    let elapsed_ms = now.second() as u64 * 1_000 + now.nanosecond() as u64 / 1_000_000;
    Duration::from_millis(60_000_u64.saturating_sub(elapsed_ms).max(25))
}

struct EngineInner {
    settings: Mutex<AppSettings>,
    status: Mutex<EngineStatus>,
    preview: Mutex<Option<Preview>>,
    settings_path: PathBuf,
    stop: AtomicBool,
    refresh: AtomicBool,
    wake_lock: Mutex<()>,
    wake: Condvar,
    worker: Mutex<Option<JoinHandle<()>>>,
}

#[derive(Clone)]
pub struct Engine(Arc<EngineInner>);

impl Engine {
    pub fn new(settings: AppSettings, settings_path: PathBuf) -> Self {
        Self(Arc::new(EngineInner {
            settings: Mutex::new(settings),
            status: Mutex::new(EngineStatus::default()),
            preview: Mutex::new(None),
            settings_path,
            stop: AtomicBool::new(false),
            refresh: AtomicBool::new(false),
            wake_lock: Mutex::new(()),
            wake: Condvar::new(),
            worker: Mutex::new(None),
        }))
    }

    pub fn start(&self) {
        let engine = self.clone();
        let worker = thread::Builder::new()
            .name("redshift-display-engine".into())
            .spawn(move || engine.run())
            .expect("could not start the display engine");
        *self.0.worker.lock().expect("engine worker lock") = Some(worker);
    }

    fn run(&self) {
        let mut last_applied: Option<(Option<(ScreenEffect, i32)>, ScreenEffect, i32, i32)> = None;
        let mut last_refresh = Instant::now() - Duration::from_secs(61);
        let mut display_count = 0;
        let mut was_active = false;

        while !self.0.stop.load(Ordering::SeqCst) {
            let force_refresh = self.0.refresh.swap(false, Ordering::SeqCst);
            let preview = {
                let mut guard = self.0.preview.lock().expect("preview lock");
                if guard
                    .as_ref()
                    .is_some_and(|preview| preview.until <= Instant::now())
                {
                    *guard = None;
                }
                guard.as_ref().map(|preview| {
                    let now = Instant::now();
                    (
                        preview.schedule.clone(),
                        preview_intensity(
                            now.saturating_duration_since(preview.started),
                            preview.until.saturating_duration_since(now),
                        ),
                        preview
                            .until
                            .saturating_duration_since(now)
                            .as_secs()
                            .saturating_add(1),
                    )
                })
            };
            let settings = self.settings();
            let scheduled = settings
                .enabled
                .then(|| schedule::evaluate(&settings, Local::now()))
                .flatten();

            let active = if let Some((schedule, intensity, seconds_left)) = &preview {
                Some((
                    EnginePhase::Preview,
                    schedule.id.clone(),
                    schedule.name.clone(),
                    schedule.effect.normalized(),
                    *intensity,
                    None,
                    Some(*seconds_left),
                ))
            } else {
                scheduled.as_ref().map(|scene| {
                    (
                        scene.phase.clone(),
                        scene.id.clone(),
                        scene.name.clone(),
                        scene.effect.clone(),
                        scene.intensity,
                        Some(scene.next_change.clone()),
                        None,
                    )
                })
            };

            let display_frame = if let Some((preview_schedule, progress, _)) = &preview {
                // Crossfade from the schedule that is genuinely active now. Starting a preview
                // from an identity frame would briefly clear an existing effect and look like a
                // flash; using the live schedule also returns to the right point after fade-out.
                Some((
                    scheduled
                        .as_ref()
                        .map(|scene| (scene.effect.clone(), scene.intensity)),
                    preview_schedule.effect.normalized(),
                    1.0_f32,
                    *progress,
                ))
            } else {
                scheduled
                    .as_ref()
                    .map(|scene| (None, scene.effect.clone(), scene.intensity, 1.0_f32))
            };

            let mut message = None;
            if let Some((from, to_effect, to_intensity, progress)) = &display_frame {
                let key = (
                    from.as_ref().map(|(effect, intensity)| {
                        (effect.clone(), (intensity * 1000.0).round() as i32)
                    }),
                    to_effect.clone(),
                    (to_intensity * 1000.0).round() as i32,
                    (progress * 1000.0).round() as i32,
                );
                let changed = last_applied.as_ref() != Some(&key);
                if changed || force_refresh || last_refresh.elapsed() >= Duration::from_secs(60) {
                    if display::supported() {
                        let result = if from.is_some() || *progress < 1.0 {
                            display::apply_transition(
                                from.as_ref()
                                    .map(|(effect, intensity)| (effect, *intensity)),
                                (to_effect, *to_intensity),
                                *progress,
                            )
                        } else {
                            display::apply(to_effect, *to_intensity)
                        };
                        match result {
                            Ok(count) => {
                                display_count = count;
                                was_active = true;
                            }
                            Err(error) => message = Some(error),
                        }
                    } else {
                        message = Some(
                            "System-wide color control is available on Windows and macOS.".into(),
                        );
                    }
                    last_applied = Some(key);
                    last_refresh = Instant::now();
                }
            } else {
                if was_active {
                    if let Err(error) = display::restore() {
                        message = Some(error);
                    }
                }
                was_active = false;
                last_applied = None;
            }

            let next_status = if let Some((
                phase,
                id,
                name,
                effect,
                intensity,
                next_change,
                preview_seconds_left,
            )) = active
            {
                EngineStatus {
                    phase,
                    schedule_id: Some(id),
                    schedule_name: Some(name),
                    intensity: intensity * (effect.strength as f32 / 100.0),
                    next_change,
                    display_count,
                    platform_supported: display::supported(),
                    message,
                    preview_seconds_left,
                }
            } else {
                EngineStatus {
                    display_count,
                    platform_supported: display::supported(),
                    message,
                    ..EngineStatus::default()
                }
            };
            let wait = match &next_status.phase {
                EnginePhase::Preview => Duration::from_millis(50),
                EnginePhase::FadeIn | EnginePhase::FadeOut => Duration::from_millis(200),
                EnginePhase::Active | EnginePhase::Idle => until_next_minute(),
            };
            *self.0.status.lock().expect("status lock") = next_status;

            let guard = self.0.wake_lock.lock().expect("engine wake lock");
            let _ = self.0.wake.wait_timeout_while(guard, wait, |_| {
                !self.0.stop.load(Ordering::SeqCst) && !self.0.refresh.load(Ordering::SeqCst)
            });
        }
        let _ = display::restore();
    }

    pub fn settings(&self) -> AppSettings {
        self.0.settings.lock().expect("settings lock").clone()
    }

    pub fn set_settings(&self, settings: AppSettings) -> Result<AppSettings, String> {
        self.write_settings(&settings)?;
        *self
            .0
            .settings
            .lock()
            .map_err(|_| "The settings lock was poisoned".to_string())? = settings.clone();
        self.refresh_now();
        Ok(settings)
    }

    fn write_settings(&self, settings: &AppSettings) -> Result<(), String> {
        if let Some(parent) = self.0.settings_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Could not create the settings folder: {error}"))?;
        }
        let body = serde_json::to_string_pretty(settings)
            .map_err(|error| format!("Could not encode settings: {error}"))?;
        fs::write(&self.0.settings_path, format!("{body}\n"))
            .map_err(|error| format!("Could not save settings: {error}"))
    }

    pub fn status(&self) -> EngineStatus {
        self.0.status.lock().expect("status lock").clone()
    }

    pub fn preview(&self, schedule: Schedule, seconds: u64) {
        let started = Instant::now();
        *self.0.preview.lock().expect("preview lock") = Some(Preview {
            schedule,
            started,
            until: started + Duration::from_secs(seconds.clamp(7, 30)),
        });
        self.refresh_now();
    }

    pub fn stop_preview(&self) {
        *self.0.preview.lock().expect("preview lock") = None;
        self.refresh_now();
    }

    pub fn refresh_now(&self) {
        self.0.refresh.store(true, Ordering::SeqCst);
        self.0.wake.notify_all();
    }

    pub fn reset_and_disable(&self) -> Result<AppSettings, String> {
        self.stop_preview();
        let mut settings = self.settings();
        settings.enabled = false;
        let settings = self.set_settings(settings)?;
        display::restore()?;
        Ok(settings)
    }

    pub fn shutdown(&self) {
        self.0.stop.store(true, Ordering::SeqCst);
        self.0.wake.notify_all();
        if let Some(worker) = self.0.worker.lock().expect("engine worker lock").take() {
            let _ = worker.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::preview_intensity;
    use std::time::Duration;

    #[test]
    fn preview_has_three_second_fades() {
        assert!(preview_intensity(Duration::ZERO, Duration::from_secs(15)) < 0.001);
        assert!(preview_intensity(Duration::from_secs(3), Duration::from_secs(12)) > 0.999);
        assert!(preview_intensity(Duration::from_secs(12), Duration::from_secs(3)) > 0.999);
        assert!(preview_intensity(Duration::from_secs(14), Duration::from_secs(1)) < 0.3);
        assert!(preview_intensity(Duration::from_secs(15), Duration::ZERO) < 0.001);
    }
}

pub fn load_settings(path: &PathBuf) -> AppSettings {
    fs::read_to_string(path)
        .ok()
        .and_then(|body| serde_json::from_str::<AppSettings>(&body).ok())
        .unwrap_or_default()
}
