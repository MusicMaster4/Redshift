use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScreenEffect {
    pub red: i16,
    pub green: i16,
    pub blue: i16,
    pub brightness: i16,
    pub contrast: i16,
    pub shadows: i16,
    pub blacks: i16,
    pub temperature: i16,
    pub strength: i16,
}

impl Default for ScreenEffect {
    fn default() -> Self {
        Self {
            red: 100,
            green: 58,
            blue: 36,
            brightness: -8,
            contrast: 4,
            shadows: 8,
            blacks: -4,
            temperature: 38,
            strength: 100,
        }
    }
}

impl ScreenEffect {
    pub fn normalized(&self) -> Self {
        let signed = |value: i16| value.clamp(-100, 100);
        let channel = |value: i16| value.clamp(0, 100);
        Self {
            red: channel(self.red),
            green: channel(self.green),
            blue: channel(self.blue),
            brightness: signed(self.brightness),
            contrast: signed(self.contrast),
            shadows: signed(self.shadows),
            blacks: signed(self.blacks),
            temperature: signed(self.temperature),
            strength: channel(self.strength),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FadeCurve {
    Linear,
    Smooth,
    Gentle,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub days: Vec<bool>,
    pub fade_in_start: String,
    pub full_start: String,
    pub fade_out_start: String,
    pub end: String,
    pub curve: FadeCurve,
    pub effect: ScreenEffect,
}

impl Default for Schedule {
    fn default() -> Self {
        Self {
            id: "evening-red".into(),
            name: "Evening red".into(),
            enabled: true,
            days: vec![true; 7],
            fade_in_start: "19:30".into(),
            full_start: "20:15".into(),
            fade_out_start: "06:15".into(),
            end: "07:00".into(),
            curve: FadeCurve::Smooth,
            effect: ScreenEffect::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub enabled: bool,
    pub run_at_login: bool,
    pub launch_hidden: bool,
    pub schedules: Vec<Schedule>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            run_at_login: true,
            launch_hidden: false,
            schedules: vec![Schedule::default()],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum EnginePhase {
    Idle,
    FadeIn,
    Active,
    FadeOut,
    Preview,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub phase: EnginePhase,
    pub schedule_id: Option<String>,
    pub schedule_name: Option<String>,
    pub intensity: f32,
    pub next_change: Option<String>,
    pub display_count: usize,
    pub platform_supported: bool,
    pub message: Option<String>,
    pub preview_seconds_left: Option<u64>,
}

impl Default for EngineStatus {
    fn default() -> Self {
        Self {
            phase: EnginePhase::Idle,
            schedule_id: None,
            schedule_name: None,
            intensity: 0.0,
            next_change: None,
            display_count: 0,
            platform_supported: cfg!(any(target_os = "windows", target_os = "macos")),
            message: None,
            preview_seconds_left: None,
        }
    }
}

pub fn validate_settings(settings: &AppSettings) -> Result<(), String> {
    if settings.schedules.is_empty() {
        return Err("Add at least one scene.".into());
    }
    for schedule in &settings.schedules {
        if schedule.id.trim().is_empty() || schedule.name.trim().is_empty() {
            return Err("Every scene needs a name and an id.".into());
        }
        if schedule.days.len() != 7 || !schedule.days.iter().any(|active| *active) {
            return Err(format!("{} needs at least one active day.", schedule.name));
        }
        crate::schedule::offsets(schedule)?;
    }
    Ok(())
}
