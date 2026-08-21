use std::sync::{Mutex, OnceLock};

use crate::model::ScreenEffect;

use super::transform_sample;

type CGDirectDisplayId = u32;
type CGError = i32;
const CG_SUCCESS: CGError = 0;

#[derive(Clone)]
struct CapturedDisplay {
    id: CGDirectDisplayId,
    red: Vec<f32>,
    green: Vec<f32>,
    blue: Vec<f32>,
}

static DISPLAYS: OnceLock<Mutex<Vec<CapturedDisplay>>> = OnceLock::new();

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn CGGetOnlineDisplayList(
        max_displays: u32,
        online_displays: *mut CGDirectDisplayId,
        display_count: *mut u32,
    ) -> CGError;
    fn CGDisplayGammaTableCapacity(display: CGDirectDisplayId) -> u32;
    fn CGGetDisplayTransferByTable(
        display: CGDirectDisplayId,
        capacity: u32,
        red: *mut f32,
        green: *mut f32,
        blue: *mut f32,
        sample_count: *mut u32,
    ) -> CGError;
    fn CGSetDisplayTransferByTable(
        display: CGDirectDisplayId,
        sample_count: u32,
        red: *const f32,
        green: *const f32,
        blue: *const f32,
    ) -> CGError;
}

fn displays() -> &'static Mutex<Vec<CapturedDisplay>> {
    DISPLAYS.get_or_init(|| Mutex::new(Vec::new()))
}

fn online_displays() -> Result<Vec<CGDirectDisplayId>, String> {
    let mut ids = [0_u32; 32];
    let mut count = 0_u32;
    let error = unsafe { CGGetOnlineDisplayList(ids.len() as u32, ids.as_mut_ptr(), &mut count) };
    if error != CG_SUCCESS {
        return Err(format!(
            "macOS could not enumerate displays (CoreGraphics error {error})"
        ));
    }
    Ok(ids[..count as usize].to_vec())
}

fn capture(id: CGDirectDisplayId) -> Result<CapturedDisplay, String> {
    let capacity = unsafe { CGDisplayGammaTableCapacity(id) }.clamp(2, 4096);
    let mut red = vec![0.0; capacity as usize];
    let mut green = vec![0.0; capacity as usize];
    let mut blue = vec![0.0; capacity as usize];
    let mut samples = 0_u32;
    let error = unsafe {
        CGGetDisplayTransferByTable(
            id,
            capacity,
            red.as_mut_ptr(),
            green.as_mut_ptr(),
            blue.as_mut_ptr(),
            &mut samples,
        )
    };
    if error != CG_SUCCESS || samples < 2 {
        return Err(format!(
            "macOS could not read display {id}'s color table (CoreGraphics error {error})"
        ));
    }
    red.truncate(samples as usize);
    green.truncate(samples as usize);
    blue.truncate(samples as usize);
    Ok(CapturedDisplay {
        id,
        red,
        green,
        blue,
    })
}

fn transformed(
    original: &[f32],
    effect: &ScreenEffect,
    intensity: f32,
    channel: usize,
) -> Vec<f32> {
    let mut previous = 0.0_f32;
    original
        .iter()
        .map(|sample| {
            let value = transform_sample(*sample, effect, intensity, channel).max(previous);
            previous = value;
            value
        })
        .collect()
}

fn transformed_transition(
    original: &[f32],
    from: Option<(&ScreenEffect, f32)>,
    to: (&ScreenEffect, f32),
    progress: f32,
    channel: usize,
) -> Vec<f32> {
    let mut previous = 0.0_f32;
    let progress = progress.clamp(0.0, 1.0);
    original
        .iter()
        .map(|sample| {
            let from_value = from.map_or(*sample, |(effect, intensity)| {
                transform_sample(*sample, effect, intensity, channel)
            });
            let to_value = transform_sample(*sample, to.0, to.1, channel);
            let value = (from_value + (to_value - from_value) * progress).max(previous);
            previous = value;
            value
        })
        .collect()
}

fn set_table(
    display: &CapturedDisplay,
    effect: &ScreenEffect,
    intensity: f32,
) -> Result<(), String> {
    let red = transformed(&display.red, effect, intensity, 0);
    let green = transformed(&display.green, effect, intensity, 1);
    let blue = transformed(&display.blue, effect, intensity, 2);
    let error = unsafe {
        CGSetDisplayTransferByTable(
            display.id,
            red.len() as u32,
            red.as_ptr(),
            green.as_ptr(),
            blue.as_ptr(),
        )
    };
    if error == CG_SUCCESS {
        Ok(())
    } else {
        Err(format!(
            "macOS refused the color table for display {} (CoreGraphics error {error})",
            display.id
        ))
    }
}

fn set_transition_table(
    display: &CapturedDisplay,
    from: Option<(&ScreenEffect, f32)>,
    to: (&ScreenEffect, f32),
    progress: f32,
) -> Result<(), String> {
    let red = transformed_transition(&display.red, from, to, progress, 0);
    let green = transformed_transition(&display.green, from, to, progress, 1);
    let blue = transformed_transition(&display.blue, from, to, progress, 2);
    let error = unsafe {
        CGSetDisplayTransferByTable(
            display.id,
            red.len() as u32,
            red.as_ptr(),
            green.as_ptr(),
            blue.as_ptr(),
        )
    };
    if error == CG_SUCCESS {
        Ok(())
    } else {
        Err(format!(
            "macOS refused the color table for display {} (CoreGraphics error {error})",
            display.id
        ))
    }
}

fn restore_display(display: &CapturedDisplay) -> Result<(), String> {
    let error = unsafe {
        CGSetDisplayTransferByTable(
            display.id,
            display.red.len() as u32,
            display.red.as_ptr(),
            display.green.as_ptr(),
            display.blue.as_ptr(),
        )
    };
    if error == CG_SUCCESS {
        Ok(())
    } else {
        Err(format!(
            "macOS could not restore display {} (CoreGraphics error {error})",
            display.id
        ))
    }
}

pub fn apply(effect: &ScreenEffect, intensity: f32) -> Result<usize, String> {
    let online = online_displays()?;
    let mut captured = displays()
        .lock()
        .map_err(|_| "The display controller lock was poisoned".to_string())?;
    for id in &online {
        if !captured.iter().any(|display| display.id == *id) {
            captured.push(capture(*id)?);
        }
    }
    for display in captured
        .iter()
        .filter(|display| online.contains(&display.id))
    {
        set_table(display, effect, intensity)?;
    }
    Ok(online.len())
}

pub fn apply_transition(
    from: Option<(&ScreenEffect, f32)>,
    to: (&ScreenEffect, f32),
    progress: f32,
) -> Result<usize, String> {
    let online = online_displays()?;
    let mut captured = displays()
        .lock()
        .map_err(|_| "The display controller lock was poisoned".to_string())?;
    for id in &online {
        if !captured.iter().any(|display| display.id == *id) {
            captured.push(capture(*id)?);
        }
    }
    for display in captured
        .iter()
        .filter(|display| online.contains(&display.id))
    {
        set_transition_table(display, from, to, progress)?;
    }
    Ok(online.len())
}

pub fn restore() -> Result<(), String> {
    let mut captured = displays()
        .lock()
        .map_err(|_| "The display controller lock was poisoned".to_string())?;
    let mut first_error = None;
    for display in captured.iter() {
        if let Err(error) = restore_display(display) {
            first_error.get_or_insert(error);
        }
    }
    captured.clear();
    match first_error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}
