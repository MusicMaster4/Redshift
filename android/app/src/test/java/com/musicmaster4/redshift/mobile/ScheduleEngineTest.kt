package com.musicmaster4.redshift.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ScheduleEngineTest {
    private val enabled = MobileSettings(enabled = true)

    @Test
    fun `cross midnight schedule stays attached to its start day`() {
        val beforeMidnight = ScheduleEngine.evaluateAt(enabled, 0, 21f * 60f)
        val afterMidnight = ScheduleEngine.evaluateAt(enabled, 1, 6.5f * 60f)
        assertEquals(ScheduleEngine.Phase.ACTIVE, beforeMidnight.phase)
        assertEquals(ScheduleEngine.Phase.FADE_OUT, afterMidnight.phase)
    }

    @Test
    fun `fade endpoints are continuous`() {
        val start = ScheduleEngine.evaluateAt(enabled, 0, 19.5f * 60f)
        val full = ScheduleEngine.evaluateAt(enabled, 0, 20.25f * 60f)
        assertTrue(start.intensity < 0.001f)
        assertTrue(full.intensity > 0.999f)
    }

    @Test
    fun `disabled schedule stays idle`() {
        val result = ScheduleEngine.evaluateAt(MobileSettings(enabled = false), 0, 21f * 60f)
        assertEquals(ScheduleEngine.Phase.IDLE, result.phase)
    }

    @Test
    fun `preview has three second fades and a nine second hold`() {
        assertTrue(ScheduleEngine.previewIntensity(0) < 0.001f)
        assertTrue(ScheduleEngine.previewIntensity(3_000) > 0.999f)
        assertTrue(ScheduleEngine.previewIntensity(12_000) > 0.999f)
        assertTrue(ScheduleEngine.previewIntensity(14_000) < 0.3f)
        assertTrue(ScheduleEngine.previewIntensity(15_000) < 0.001f)
    }
}
