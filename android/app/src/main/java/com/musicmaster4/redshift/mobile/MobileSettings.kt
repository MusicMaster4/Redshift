package com.musicmaster4.redshift.mobile

data class MobileSettings(
    val enabled: Boolean = false,
    val days: BooleanArray = BooleanArray(7) { true },
    val fadeInStart: String = "19:30",
    val fullStart: String = "20:15",
    val fadeOutStart: String = "06:15",
    val end: String = "07:00",
    val red: Int = 100,
    val green: Int = 58,
    val blue: Int = 36,
    val darkness: Int = 18,
    val temperature: Int = 38,
    val strength: Int = 85,
)
