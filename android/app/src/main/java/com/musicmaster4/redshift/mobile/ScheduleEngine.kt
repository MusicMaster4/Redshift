package com.musicmaster4.redshift.mobile

import java.util.Calendar
import kotlin.math.cos

object ScheduleEngine {
    const val PREVIEW_DURATION_MS = 15_000L
    const val PREVIEW_FADE_MS = 3_000L

    enum class Phase { IDLE, FADE_IN, ACTIVE, FADE_OUT }

    data class Result(val phase: Phase, val intensity: Float, val nextChange: String?)

    private fun minutes(value: String): Int {
        val parts = value.split(":")
        require(parts.size == 2) { "Invalid time: $value" }
        val hour = parts[0].toInt()
        val minute = parts[1].toInt()
        require(hour in 0..23 && minute in 0..59) { "Invalid time: $value" }
        return hour * 60 + minute
    }

    fun offsets(settings: MobileSettings): IntArray {
        val values = intArrayOf(
            minutes(settings.fadeInStart),
            minutes(settings.fullStart),
            minutes(settings.fadeOutStart),
            minutes(settings.end),
        )
        for (index in 1 until values.size) {
            while (values[index] <= values[index - 1]) values[index] += 24 * 60
        }
        require(values[3] - values[0] <= 24 * 60) { "Schedule cannot exceed 24 hours" }
        return values
    }

    private fun smooth(progress: Float): Float {
        val value = progress.coerceIn(0f, 1f)
        return (0.5 - cos(Math.PI * value) / 2.0).toFloat()
    }

    fun previewIntensity(elapsedMs: Long, durationMs: Long = PREVIEW_DURATION_MS): Float {
        val elapsed = elapsedMs.coerceAtLeast(0L)
        val remaining = (durationMs - elapsed).coerceAtLeast(0L)
        val envelope = minOf(
            1f,
            elapsed.toFloat() / PREVIEW_FADE_MS,
            remaining.toFloat() / PREVIEW_FADE_MS,
        )
        return smooth(envelope)
    }

    private fun timeLabel(value: Int): String {
        val local = value % (24 * 60)
        return "%02d:%02d".format(local / 60, local % 60)
    }

    private fun candidate(settings: MobileSettings, day: Int, minute: Float, previousDay: Boolean): Result? {
        if (!settings.enabled) return null
        val anchorDay = if (previousDay) (day + 6) % 7 else day
        if (!settings.days.getOrElse(anchorDay) { false }) return null
        val (start, full, fadeOut, end) = offsets(settings)
        val position = minute + if (previousDay) 24f * 60f else 0f
        if (position < start || position >= end) return null
        return when {
            position < full -> Result(
                Phase.FADE_IN,
                smooth((position - start) / (full - start)),
                timeLabel(full),
            )
            position < fadeOut -> Result(Phase.ACTIVE, 1f, timeLabel(fadeOut))
            else -> Result(
                Phase.FADE_OUT,
                1f - smooth((position - fadeOut) / (end - fadeOut)),
                timeLabel(end),
            )
        }
    }

    fun evaluateAt(settings: MobileSettings, day: Int, minute: Float): Result {
        return listOfNotNull(
            candidate(settings, day, minute, false),
            candidate(settings, day, minute, true),
        ).maxByOrNull { it.intensity } ?: Result(Phase.IDLE, 0f, null)
    }

    fun evaluate(settings: MobileSettings, now: Calendar = Calendar.getInstance()): Result {
        val day = (now.get(Calendar.DAY_OF_WEEK) + 5) % 7
        val minute = now.get(Calendar.HOUR_OF_DAY) * 60f + now.get(Calendar.MINUTE) + now.get(Calendar.SECOND) / 60f
        return evaluateAt(settings, day, minute)
    }
}
