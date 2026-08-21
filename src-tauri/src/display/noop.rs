use crate::model::ScreenEffect;

pub fn apply(_effect: &ScreenEffect, _intensity: f32) -> Result<usize, String> {
    Err("System-wide color control is available on Windows and macOS.".into())
}

pub fn restore() -> Result<(), String> {
    Ok(())
}
