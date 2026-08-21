use crate::model::ScreenEffect;

pub fn apply(_effect: &ScreenEffect, _intensity: f32) -> Result<usize, String> {
    Err("System-wide color control is available on Windows and macOS.".into())
}

pub fn apply_transition(
    _from: Option<(&ScreenEffect, f32)>,
    _to: (&ScreenEffect, f32),
    _progress: f32,
) -> Result<usize, String> {
    Err("System-wide color control is available on Windows and macOS.".into())
}

pub fn restore() -> Result<(), String> {
    Ok(())
}
