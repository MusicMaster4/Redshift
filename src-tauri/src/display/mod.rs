use crate::model::ScreenEffect;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
mod noop;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "macos")]
use macos as platform;
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
use noop as platform;
#[cfg(target_os = "windows")]
use windows as platform;

pub fn apply(effect: &ScreenEffect, intensity: f32) -> Result<usize, String> {
    platform::apply(effect, intensity)
}

pub fn restore() -> Result<(), String> {
    platform::restore()
}

pub fn supported() -> bool {
    cfg!(any(target_os = "windows", target_os = "macos"))
}

pub(crate) fn transform_sample(
    sample: f32,
    effect: &ScreenEffect,
    intensity: f32,
    channel: usize,
) -> f32 {
    let effect = effect.normalized();
    let master = (effect.strength as f32 / 100.0) * intensity.clamp(0.0, 1.0);
    if master <= f32::EPSILON {
        return sample.clamp(0.0, 1.0);
    }

    let mut value = sample.clamp(0.0, 1.0);
    let black = effect.blacks as f32 / 100.0;
    if black >= 0.0 {
        value += black * 0.12 * (1.0 - value);
    } else {
        let threshold = -black * 0.12;
        value = ((value - threshold) / (1.0 - threshold)).max(0.0);
    }

    let shadows = effect.shadows as f32 / 100.0;
    value += shadows * 0.42 * value * (1.0 - value).powi(2);
    value += effect.brightness as f32 / 100.0 * 0.24;
    let contrast = 1.0 + effect.contrast as f32 / 100.0 * 0.82;
    value = (value - 0.5) * contrast + 0.5;

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
    let target = (value * gains[channel]).clamp(0.0, 1.0);
    (sample + (target - sample) * master).clamp(0.0, 1.0)
}

pub(crate) fn build_u16_ramp(
    original: &[[u16; 256]; 3],
    effect: &ScreenEffect,
    intensity: f32,
) -> [[u16; 256]; 3] {
    let mut result = [[0_u16; 256]; 3];
    for channel in 0..3 {
        let mut previous = 0_u16;
        for index in 0..256 {
            let sample = original[channel][index] as f32 / u16::MAX as f32;
            let transformed = (transform_sample(sample, effect, intensity, channel)
                * u16::MAX as f32)
                .round() as u16;
            let monotonic = transformed.max(previous);
            result[channel][index] = monotonic;
            previous = monotonic;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity() -> [[u16; 256]; 3] {
        let mut result = [[0_u16; 256]; 3];
        for channel in &mut result {
            for (index, value) in channel.iter_mut().enumerate() {
                *value = (index as u32 * 257) as u16;
            }
        }
        result
    }

    #[test]
    fn zero_intensity_is_original() {
        let original = identity();
        assert_eq!(
            build_u16_ramp(&original, &ScreenEffect::default(), 0.0),
            original
        );
    }

    #[test]
    fn red_only_really_disables_green_and_blue() {
        let original = identity();
        let effect = ScreenEffect {
            red: 100,
            green: 0,
            blue: 0,
            brightness: 0,
            contrast: 0,
            shadows: 0,
            blacks: 0,
            temperature: 0,
            strength: 100,
        };
        let ramp = build_u16_ramp(&original, &effect, 1.0);
        assert_eq!(ramp[1], [0; 256]);
        assert_eq!(ramp[2], [0; 256]);
        assert_eq!(ramp[0], original[0]);
    }

    #[test]
    fn every_channel_stays_monotonic() {
        let ramp = build_u16_ramp(&identity(), &ScreenEffect::default(), 1.0);
        for channel in ramp {
            assert!(channel.windows(2).all(|pair| pair[0] <= pair[1]));
        }
    }
}
