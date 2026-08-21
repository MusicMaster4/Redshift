package com.musicmaster4.redshift.mobile

import android.content.Context

class SettingsStore(context: Context) {
    private val preferences = context.getSharedPreferences("redshift-mobile", Context.MODE_PRIVATE)

    fun load(): MobileSettings {
        val days = preferences.getString("days", "1111111")
            ?.padEnd(7, '1')
            ?.take(7)
            ?.map { it == '1' }
            ?.toBooleanArray()
            ?: BooleanArray(7) { true }
        return MobileSettings(
            enabled = preferences.getBoolean("enabled", false),
            days = days,
            fadeInStart = preferences.getString("fadeInStart", "19:30") ?: "19:30",
            fullStart = preferences.getString("fullStart", "20:15") ?: "20:15",
            fadeOutStart = preferences.getString("fadeOutStart", "06:15") ?: "06:15",
            end = preferences.getString("end", "07:00") ?: "07:00",
            red = preferences.getInt("red", 100).coerceIn(0, 100),
            green = preferences.getInt("green", 58).coerceIn(0, 100),
            blue = preferences.getInt("blue", 36).coerceIn(0, 100),
            darkness = preferences.getInt("darkness", 18).coerceIn(0, 100),
            temperature = preferences.getInt("temperature", 38).coerceIn(-100, 100),
            strength = preferences.getInt("strength", 85).coerceIn(0, 100),
        )
    }

    fun save(settings: MobileSettings) {
        preferences.edit()
            .putBoolean("enabled", settings.enabled)
            .putString("days", settings.days.joinToString("") { if (it) "1" else "0" })
            .putString("fadeInStart", settings.fadeInStart)
            .putString("fullStart", settings.fullStart)
            .putString("fadeOutStart", settings.fadeOutStart)
            .putString("end", settings.end)
            .putInt("red", settings.red.coerceIn(0, 100))
            .putInt("green", settings.green.coerceIn(0, 100))
            .putInt("blue", settings.blue.coerceIn(0, 100))
            .putInt("darkness", settings.darkness.coerceIn(0, 100))
            .putInt("temperature", settings.temperature.coerceIn(-100, 100))
            .putInt("strength", settings.strength.coerceIn(0, 100))
            .apply()
    }
}
