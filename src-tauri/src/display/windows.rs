use std::{
    ffi::c_void,
    mem::{size_of, zeroed},
    ptr,
    sync::{Mutex, OnceLock},
};

use crate::model::ScreenEffect;

use super::build_u16_transition_ramp;

const DISPLAY_DEVICE_ATTACHED_TO_DESKTOP: u32 = 0x0000_0001;
const DISPLAY_DEVICE_MIRRORING_DRIVER: u32 = 0x0000_0008;

#[repr(C)]
#[derive(Clone, Copy)]
struct DisplayDeviceW {
    cb: u32,
    device_name: [u16; 32],
    device_string: [u16; 128],
    state_flags: u32,
    device_id: [u16; 128],
    device_key: [u16; 128],
}

#[repr(C)]
#[derive(Clone, Copy)]
struct GammaRamp {
    red: [u16; 256],
    green: [u16; 256],
    blue: [u16; 256],
}

impl GammaRamp {
    fn channels(&self) -> [[u16; 256]; 3] {
        [self.red, self.green, self.blue]
    }

    fn from_channels(channels: [[u16; 256]; 3]) -> Self {
        Self {
            red: channels[0],
            green: channels[1],
            blue: channels[2],
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
struct MagColorEffect {
    transform: [[f32; 5]; 5],
}

#[derive(Clone)]
struct CapturedDisplay {
    name: Vec<u16>,
    original: GammaRamp,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    None,
    Gamma,
    Magnification,
}

struct PlatformState {
    mode: Mode,
    displays: Vec<CapturedDisplay>,
    previous_magnification: Option<MagColorEffect>,
    magnification_initialized: bool,
}

impl Default for PlatformState {
    fn default() -> Self {
        Self {
            mode: Mode::None,
            displays: Vec::new(),
            previous_magnification: None,
            magnification_initialized: false,
        }
    }
}

static STATE: OnceLock<Mutex<PlatformState>> = OnceLock::new();

#[link(name = "User32")]
extern "system" {
    fn EnumDisplayDevicesW(
        device: *const u16,
        device_number: u32,
        display_device: *mut DisplayDeviceW,
        flags: u32,
    ) -> i32;
}

#[link(name = "Gdi32")]
extern "system" {
    fn CreateDCW(
        driver: *const u16,
        device: *const u16,
        port: *const u16,
        dev_mode: *const c_void,
    ) -> isize;
    fn DeleteDC(dc: isize) -> i32;
    fn GetDeviceGammaRamp(dc: isize, ramp: *mut c_void) -> i32;
    fn SetDeviceGammaRamp(dc: isize, ramp: *const c_void) -> i32;
}

#[link(name = "Magnification")]
extern "system" {
    fn MagInitialize() -> i32;
    fn MagUninitialize() -> i32;
    fn MagGetFullscreenColorEffect(effect: *mut MagColorEffect) -> i32;
    fn MagSetFullscreenColorEffect(effect: *const MagColorEffect) -> i32;
}

fn state() -> &'static Mutex<PlatformState> {
    STATE.get_or_init(|| Mutex::new(PlatformState::default()))
}

fn active_displays() -> Vec<Vec<u16>> {
    let mut result = Vec::new();
    for number in 0..32 {
        let mut device: DisplayDeviceW = unsafe { zeroed() };
        device.cb = size_of::<DisplayDeviceW>() as u32;
        if unsafe { EnumDisplayDevicesW(ptr::null(), number, &mut device, 0) } == 0 {
            break;
        }
        if device.state_flags & DISPLAY_DEVICE_ATTACHED_TO_DESKTOP == 0
            || device.state_flags & DISPLAY_DEVICE_MIRRORING_DRIVER != 0
        {
            continue;
        }
        let end = device
            .device_name
            .iter()
            .position(|character| *character == 0)
            .unwrap_or(device.device_name.len());
        let mut name = device.device_name[..end].to_vec();
        name.push(0);
        result.push(name);
    }
    result
}

fn with_display_dc<T>(
    name: &[u16],
    operation: impl FnOnce(isize) -> Result<T, String>,
) -> Result<T, String> {
    let driver: Vec<u16> = "DISPLAY\0".encode_utf16().collect();
    let dc = unsafe { CreateDCW(driver.as_ptr(), name.as_ptr(), ptr::null(), ptr::null()) };
    if dc == 0 {
        return Err(last_error("Windows could not open a display color context"));
    }
    let result = operation(dc);
    unsafe { DeleteDC(dc) };
    result
}

fn read_gamma(name: &[u16]) -> Result<GammaRamp, String> {
    with_display_dc(name, |dc| {
        let mut ramp: GammaRamp = unsafe { zeroed() };
        if unsafe { GetDeviceGammaRamp(dc, &mut ramp as *mut _ as *mut c_void) } == 0 {
            Err(last_error(
                "Windows could not read the display transfer table",
            ))
        } else {
            Ok(ramp)
        }
    })
}

fn write_gamma(name: &[u16], ramp: &GammaRamp) -> Result<(), String> {
    with_display_dc(name, |dc| {
        if unsafe { SetDeviceGammaRamp(dc, ramp as *const _ as *const c_void) } == 0 {
            Err(last_error("The display driver rejected the transfer table"))
        } else {
            Ok(())
        }
    })
}

fn restore_gamma(displays: &[CapturedDisplay]) {
    for display in displays {
        let _ = write_gamma(&display.name, &display.original);
    }
}

fn initialize_magnification(state: &mut PlatformState) -> Result<(), String> {
    if state.magnification_initialized {
        return Ok(());
    }
    if unsafe { MagInitialize() } == 0 {
        return Err(last_error(
            "Windows could not initialize its full-screen color filter",
        ));
    }
    let mut previous = identity_matrix();
    if unsafe { MagGetFullscreenColorEffect(&mut previous) } == 0 {
        unsafe { MagUninitialize() };
        return Err(last_error(
            "Windows could not read the current full-screen color filter",
        ));
    }
    state.previous_magnification = Some(previous);
    state.magnification_initialized = true;
    Ok(())
}

fn identity_matrix() -> MagColorEffect {
    MagColorEffect {
        transform: [
            [1.0, 0.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 0.0, 1.0],
        ],
    }
}

fn linear_matrix(effect: &ScreenEffect, intensity: f32) -> MagColorEffect {
    let effect = effect.normalized();
    let master = (effect.strength as f32 / 100.0) * intensity.clamp(0.0, 1.0);
    let temperature = effect.temperature as f32 / 100.0;
    let mut gains = [
        effect.red as f32 / 100.0,
        effect.green as f32 / 100.0,
        effect.blue as f32 / 100.0,
    ];
    if temperature > 0.0 {
        gains[0] *= 1.0 + 0.12 * temperature;
        gains[1] *= 1.0 - 0.035 * temperature;
        gains[2] *= 1.0 - 0.18 * temperature;
    } else {
        let cool = -temperature;
        gains[0] *= 1.0 - 0.15 * cool;
        gains[1] *= 1.0 - 0.02 * cool;
        gains[2] *= 1.0 + 0.12 * cool;
    }

    let black = effect.blacks as f32 / 100.0;
    let mut slope = 1.0 + effect.contrast as f32 / 100.0 * 0.82;
    let mut offset =
        effect.brightness as f32 / 100.0 * 0.24 + effect.shadows as f32 / 100.0 * 0.035;
    if black >= 0.0 {
        slope *= 1.0 - black * 0.12;
        offset += black * 0.12;
    } else {
        let threshold = -black * 0.12;
        slope /= 1.0 - threshold;
        offset -= threshold / (1.0 - threshold);
    }
    offset += (1.0 - slope) * 0.5;

    let mut matrix = identity_matrix();
    for channel in 0..3 {
        matrix.transform[channel][channel] = 1.0 + (slope * gains[channel] - 1.0) * master;
        matrix.transform[4][channel] = offset * gains[channel] * master;
    }
    matrix
}

fn transition_matrix(
    from: Option<(&ScreenEffect, f32)>,
    to: (&ScreenEffect, f32),
    progress: f32,
) -> MagColorEffect {
    let from = from.map_or_else(identity_matrix, |(effect, intensity)| {
        linear_matrix(effect, intensity)
    });
    let to = linear_matrix(to.0, to.1);
    let progress = progress.clamp(0.0, 1.0);
    let mut result = identity_matrix();
    for row in 0..5 {
        for column in 0..5 {
            result.transform[row][column] = from.transform[row][column]
                + (to.transform[row][column] - from.transform[row][column]) * progress;
        }
    }
    result
}

fn apply_magnification(
    state: &mut PlatformState,
    from: Option<(&ScreenEffect, f32)>,
    to: (&ScreenEffect, f32),
    progress: f32,
) -> Result<(), String> {
    initialize_magnification(state)?;
    let matrix = transition_matrix(from, to, progress);
    if unsafe { MagSetFullscreenColorEffect(&matrix) } == 0 {
        return Err(last_error("Windows refused the full-screen color filter"));
    }
    state.mode = Mode::Magnification;
    Ok(())
}

fn abandon_magnification(state: &mut PlatformState) {
    if state.magnification_initialized {
        if let Some(previous) = state.previous_magnification {
            unsafe { MagSetFullscreenColorEffect(&previous) };
        }
        unsafe { MagUninitialize() };
    }
    state.previous_magnification = None;
    state.magnification_initialized = false;
    state.mode = Mode::None;
}

pub fn apply(effect: &ScreenEffect, intensity: f32) -> Result<usize, String> {
    apply_transition(None, (effect, intensity), 1.0)
}

pub fn apply_transition(
    from: Option<(&ScreenEffect, f32)>,
    to: (&ScreenEffect, f32),
    progress: f32,
) -> Result<usize, String> {
    let names = active_displays();
    let display_count = names.len().max(1);
    let mut state = state()
        .lock()
        .map_err(|_| "The display controller lock was poisoned".to_string())?;

    if state.mode == Mode::Magnification {
        apply_magnification(&mut state, from, to, progress)?;
        return Ok(display_count);
    }

    if state.mode == Mode::None {
        // The full-screen matrix is safe to replace throughout an animation. Hardware gamma
        // writes can block for a noticeable amount of time, so they remain a compatibility
        // fallback instead of driving every preview frame.
        if apply_magnification(&mut state, from, to, progress).is_ok() {
            return Ok(display_count);
        }
        abandon_magnification(&mut state);
    }

    for name in &names {
        if state.displays.iter().any(|display| display.name == *name) {
            continue;
        }
        match read_gamma(name) {
            Ok(original) => state.displays.push(CapturedDisplay {
                name: name.clone(),
                original,
            }),
            Err(error) => return Err(error),
        }
    }

    if state.displays.is_empty() {
        return Err("Windows could not find a controllable display".into());
    }

    for display in &state.displays {
        let channels = build_u16_transition_ramp(&display.original.channels(), from, to, progress);
        write_gamma(&display.name, &GammaRamp::from_channels(channels))?;
    }
    state.mode = Mode::Gamma;
    Ok(display_count)
}

pub fn restore() -> Result<(), String> {
    let mut state = state()
        .lock()
        .map_err(|_| "The display controller lock was poisoned".to_string())?;
    if state.mode == Mode::Gamma {
        restore_gamma(&state.displays);
    }
    if state.magnification_initialized {
        if let Some(previous) = state.previous_magnification {
            if unsafe { MagSetFullscreenColorEffect(&previous) } == 0 {
                return Err(last_error(
                    "Windows could not restore the previous color filter",
                ));
            }
        }
        unsafe { MagUninitialize() };
    }
    *state = PlatformState::default();
    Ok(())
}

fn last_error(context: &str) -> String {
    format!("{context}: {}", std::io::Error::last_os_error())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn animated_matrix_keeps_exact_endpoints() {
        let from = ScreenEffect::default();
        let to = ScreenEffect {
            red: 100,
            green: 0,
            blue: 0,
            ..ScreenEffect::default()
        };
        assert_eq!(
            transition_matrix(Some((&from, 0.4)), (&to, 1.0), 0.0),
            linear_matrix(&from, 0.4)
        );
        assert_eq!(
            transition_matrix(Some((&from, 0.4)), (&to, 1.0), 1.0),
            linear_matrix(&to, 1.0)
        );
    }
}
