use chrono::{DateTime, Datelike, Local, Timelike};

use crate::model::{AppSettings, EnginePhase, FadeCurve, Schedule, ScreenEffect};

#[derive(Debug, Clone)]
pub struct ActiveScene {
    pub id: String,
    pub name: String,
    pub phase: EnginePhase,
    pub intensity: f32,
    pub effect: ScreenEffect,
    pub next_change: String,
}

fn parse_time(value: &str) -> Result<u32, String> {
    let (hour, minute) = value
        .split_once(':')
        .ok_or_else(|| format!("Invalid time: {value}"))?;
    let hour = hour
        .parse::<u32>()
        .map_err(|_| format!("Invalid time: {value}"))?;
    let minute = minute
        .parse::<u32>()
        .map_err(|_| format!("Invalid time: {value}"))?;
    if hour > 23 || minute > 59 {
        return Err(format!("Invalid time: {value}"));
    }
    Ok(hour * 60 + minute)
}

pub fn offsets(schedule: &Schedule) -> Result<[u32; 4], String> {
    let raw = [
        parse_time(&schedule.fade_in_start)?,
        parse_time(&schedule.full_start)?,
        parse_time(&schedule.fade_out_start)?,
        parse_time(&schedule.end)?,
    ];
    let mut result = raw;
    for index in 1..result.len() {
        while result[index] <= result[index - 1] {
            result[index] += 24 * 60;
        }
    }
    if result[3] - result[0] > 24 * 60 {
        return Err(format!("{} lasts longer than 24 hours.", schedule.name));
    }
    Ok(result)
}

fn curve(kind: FadeCurve, progress: f32) -> f32 {
    let value = progress.clamp(0.0, 1.0);
    match kind {
        FadeCurve::Linear => value,
        FadeCurve::Gentle => value * value * (3.0 - 2.0 * value),
        FadeCurve::Smooth => 0.5 - (std::f32::consts::PI * value).cos() / 2.0,
    }
}

fn display_time(minutes: u32) -> String {
    let local = minutes % (24 * 60);
    format!("{:02}:{:02}", local / 60, local % 60)
}

fn candidate(
    schedule: &Schedule,
    day_index: usize,
    minute: f32,
    previous_day: bool,
) -> Option<ActiveScene> {
    if !schedule.enabled {
        return None;
    }
    let anchor_day = if previous_day {
        (day_index + 6) % 7
    } else {
        day_index
    };
    if !schedule.days.get(anchor_day).copied().unwrap_or(false) {
        return None;
    }
    let [start, full, fade_out, end] = offsets(schedule).ok()?;
    let position = minute + if previous_day { 24.0 * 60.0 } else { 0.0 };
    if position < start as f32 || position >= end as f32 {
        return None;
    }
    let (phase, intensity, next) = if position < full as f32 {
        let progress = (position - start as f32) / (full - start) as f32;
        (EnginePhase::FadeIn, curve(schedule.curve, progress), full)
    } else if position < fade_out as f32 {
        (EnginePhase::Active, 1.0, fade_out)
    } else {
        let progress = (position - fade_out as f32) / (end - fade_out) as f32;
        (
            EnginePhase::FadeOut,
            1.0 - curve(schedule.curve, progress),
            end,
        )
    };
    Some(ActiveScene {
        id: schedule.id.clone(),
        name: schedule.name.clone(),
        phase,
        intensity,
        effect: schedule.effect.normalized(),
        next_change: display_time(next),
    })
}

pub fn evaluate_at(settings: &AppSettings, day_index: usize, minute: f32) -> Option<ActiveScene> {
    settings
        .schedules
        .iter()
        .flat_map(|schedule| {
            [
                candidate(schedule, day_index, minute, false),
                candidate(schedule, day_index, minute, true),
            ]
        })
        .flatten()
        .max_by(|a, b| {
            let a_score = a.intensity * (a.effect.strength as f32 / 100.0);
            let b_score = b.intensity * (b.effect.strength as f32 / 100.0);
            a_score.total_cmp(&b_score)
        })
}

pub fn evaluate(settings: &AppSettings, now: DateTime<Local>) -> Option<ActiveScene> {
    let day_index = now.weekday().num_days_from_monday() as usize;
    let minute = now.hour() as f32 * 60.0 + now.minute() as f32 + now.second() as f32 / 60.0;
    evaluate_at(settings, day_index, minute)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{AppSettings, EnginePhase, Schedule};

    #[test]
    fn cross_midnight_scene_uses_anchor_day() {
        let settings = AppSettings {
            schedules: vec![Schedule::default()],
            ..AppSettings::default()
        };
        let before_midnight = evaluate_at(&settings, 0, 21.0 * 60.0).unwrap();
        assert_eq!(before_midnight.phase, EnginePhase::Active);
        let after_midnight = evaluate_at(&settings, 1, 6.5 * 60.0).unwrap();
        assert_eq!(after_midnight.phase, EnginePhase::FadeOut);
    }

    #[test]
    fn fade_is_continuous_at_boundaries() {
        let settings = AppSettings::default();
        let start = evaluate_at(&settings, 0, 19.5 * 60.0).unwrap();
        let full = evaluate_at(&settings, 0, 20.25 * 60.0).unwrap();
        assert!(start.intensity.abs() < 0.001);
        assert!((full.intensity - 1.0).abs() < 0.001);
    }

    #[test]
    fn suspend_jump_recomputes_from_wall_clock() {
        let settings = AppSettings::default();
        let before_sleep = evaluate_at(&settings, 0, 19.0 * 60.0 + 40.0).unwrap();
        let after_wake = evaluate_at(&settings, 0, 20.0 * 60.0).unwrap();
        assert!(after_wake.intensity > before_sleep.intensity);

        let before_fade_out_sleep = evaluate_at(&settings, 1, 6.0 * 60.0 + 20.0).unwrap();
        let after_fade_out_wake = evaluate_at(&settings, 1, 6.0 * 60.0 + 50.0).unwrap();
        assert!(after_fade_out_wake.intensity < before_fade_out_sleep.intensity);
    }

    #[test]
    fn rejects_scenes_over_a_day() {
        let mut schedule = Schedule::default();
        schedule.full_start = schedule.fade_in_start.clone();
        assert!(offsets(&schedule).is_err());
    }
}
