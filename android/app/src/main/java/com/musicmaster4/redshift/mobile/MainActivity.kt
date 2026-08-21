package com.musicmaster4.redshift.mobile

import android.Manifest
import android.app.TimePickerDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.Space
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SwitchCompat
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {
    companion object {
        private const val NOTIFICATION_PERMISSION_REQUEST = 42
        private const val COLOR_BACKGROUND = "#0D0E10"
        private const val COLOR_SURFACE = "#17181D"
        private const val COLOR_LINE = "#30323A"
        private const val COLOR_TEXT = "#F1F1F3"
        private const val COLOR_SECONDARY = "#C1C2C8"
        private const val COLOR_MUTED = "#989AA4"
        private const val COLOR_ACCENT = "#E6474D"
    }

    private lateinit var store: SettingsStore
    private lateinit var current: MobileSettings
    private lateinit var scheduleSwitch: SwitchCompat
    private lateinit var scheduleStatus: TextView
    private lateinit var permissionAction: TextView
    private lateinit var feedback: TextView
    private lateinit var previewSwatch: View
    private val dayControls = mutableListOf<Pair<TextView, View>>()
    private val timeValues = mutableMapOf<String, TextView>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = color(COLOR_BACKGROUND)
        window.navigationBarColor = color(COLOR_BACKGROUND)
        store = SettingsStore(this)
        current = store.load()
        setContentView(buildScreen())
        refreshControls()
    }

    override fun onResume() {
        super.onResume()
        if (!::scheduleSwitch.isInitialized) return
        refreshPermissionState()
        if (current.enabled && Settings.canDrawOverlays(this)) {
            ScreenFilterService.refresh(this)
        }
    }

    private fun buildScreen(): View {
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            setBackgroundColor(color(COLOR_BACKGROUND))
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(22), dp(22), dp(36))
        }
        scroll.addView(content, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        content.addView(buildHeader())
        content.addView(space(26))
        content.addView(buildScheduleStatus())
        content.addView(space(28))
        content.addView(sectionHeading("Schedule", "Four points define the transition."))
        content.addView(space(17))
        content.addView(buildDays())
        content.addView(space(22))
        content.addView(buildTimes())
        content.addView(space(30))
        content.addView(divider())
        content.addView(space(26))
        content.addView(sectionHeading("Tint mix", "Android blends this color over the display."))
        content.addView(space(14))
        content.addView(slider("Red", 0, 100, current.red, "%") { current = current.copy(red = it); updatePreviewSwatch() })
        content.addView(slider("Green", 0, 100, current.green, "%") { current = current.copy(green = it); updatePreviewSwatch() })
        content.addView(slider("Blue", 0, 100, current.blue, "%") { current = current.copy(blue = it); updatePreviewSwatch() })
        previewSwatch = View(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(30)).also { it.topMargin = dp(12) }
        }
        content.addView(previewSwatch)
        content.addView(space(30))
        content.addView(divider())
        content.addView(space(26))
        content.addView(sectionHeading("Output", "Adjust dimming, temperature, and strength."))
        content.addView(space(14))
        content.addView(slider("Darkness", 0, 100, current.darkness, "%") { current = current.copy(darkness = it) })
        content.addView(slider("Temperature", -100, 100, current.temperature, "") { current = current.copy(temperature = it); updatePreviewSwatch() })
        content.addView(slider("Strength", 0, 100, current.strength, "%") { current = current.copy(strength = it) })
        content.addView(space(30))
        content.addView(divider())
        content.addView(space(24))
        content.addView(buildAndroidNote())
        content.addView(space(26))
        content.addView(buildActions())
        feedback = bodyText("", 12f, COLOR_MUTED).apply {
            minHeight = dp(38)
            setPadding(0, dp(12), 0, 0)
        }
        content.addView(feedback)
        content.addView(space(18))
        content.addView(buildUpdateRow())
        return scroll
    }

    private fun buildHeader(): View {
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(ImageView(this@MainActivity).apply {
                setImageResource(R.mipmap.ic_launcher)
                scaleType = ImageView.ScaleType.CENTER_CROP
                layoutParams = LinearLayout.LayoutParams(dp(48), dp(48))
                contentDescription = null
            })
            addView(LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(14), 0, 0, 0)
                addView(bodyText("Redshift", 23f, COLOR_TEXT, Typeface.BOLD))
                addView(bodyText(
                    "${if (BuildConfig.UPDATE_CHANNEL == "testing") "Beta" else "Stable"} channel  |  v${BuildConfig.VERSION_NAME}",
                    12f,
                    COLOR_MUTED,
                ).apply { setPadding(0, dp(3), 0, 0) })
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        }
    }

    private fun buildScheduleStatus(): View {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = solid(COLOR_SURFACE, 6f, COLOR_LINE)
            setPadding(dp(16), dp(15), dp(16), dp(14))
            addView(LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                addView(LinearLayout(this@MainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    addView(bodyText("Automatic schedule", 14f, COLOR_TEXT, Typeface.BOLD))
                    scheduleStatus = bodyText("", 12f, COLOR_MUTED).apply { setPadding(0, dp(5), 0, 0) }
                    addView(scheduleStatus)
                }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                scheduleSwitch = SwitchCompat(this@MainActivity).apply {
                    showText = false
                    buttonTintList = null
                    setOnCheckedChangeListener { _, enabled ->
                        if (enabled && !Settings.canDrawOverlays(this@MainActivity)) {
                            isChecked = false
                            openOverlayPermission()
                            return@setOnCheckedChangeListener
                        }
                        current = current.copy(enabled = enabled)
                        store.save(current)
                        if (enabled) {
                            requestNotificationPermissionIfNeeded()
                            ScreenFilterService.refresh(this@MainActivity)
                        } else {
                            ScreenFilterService.stop(this@MainActivity)
                        }
                        updateScheduleStatus()
                    }
                }
                addView(scheduleSwitch)
            })
            permissionAction = actionText("Allow display over other apps", primary = false).apply {
                setOnClickListener { openOverlayPermission() }
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(42)).also { it.topMargin = dp(14) }
            }
            addView(permissionAction)
        }
    }

    private fun buildDays(): View {
        val labels = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            labels.forEachIndexed { index, label ->
                val cell = LinearLayout(this@MainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    gravity = Gravity.CENTER
                    isClickable = true
                    isFocusable = true
                    contentDescription = label
                    background = ripple("#00000000", 3f)
                    setOnClickListener {
                        current.days[index] = !current.days[index]
                        updateDayControls()
                    }
                }
                val text = bodyText(label.take(1), 12f, COLOR_MUTED, Typeface.BOLD).apply {
                    gravity = Gravity.CENTER
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
                }
                val marker = View(this@MainActivity).apply {
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(2)).also {
                        it.marginStart = dp(3)
                        it.marginEnd = dp(3)
                    }
                }
                cell.addView(text)
                cell.addView(marker)
                dayControls += text to marker
                addView(cell, LinearLayout.LayoutParams(0, dp(42), 1f).also { params ->
                    if (index > 0) params.marginStart = dp(4)
                })
            }
        }
    }

    private fun buildTimes(): View {
        val container = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val rows = listOf(
            listOf("fadeInStart" to "Fade in", "fullStart" to "Full effect"),
            listOf("fadeOutStart" to "Fade out", "end" to "Off"),
        )
        rows.forEachIndexed { rowIndex, entries ->
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            entries.forEachIndexed { columnIndex, (key, label) ->
                val control = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(if (columnIndex == 0) 0 else dp(16), dp(12), if (columnIndex == 0) dp(16) else 0, dp(11))
                    background = ripple("#00000000", 0f)
                    isClickable = true
                    isFocusable = true
                    setOnClickListener { pickTime(key) }
                    addView(bodyText(label, 11f, COLOR_MUTED))
                    val value = bodyText(timeValue(key), 16f, COLOR_TEXT, Typeface.BOLD).apply { setPadding(0, dp(5), 0, 0) }
                    timeValues[key] = value
                    addView(value)
                    addView(View(this@MainActivity).apply { setBackgroundColor(color(COLOR_LINE)) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)))
                }
                row.addView(control, LinearLayout.LayoutParams(0, dp(68), 1f))
            }
            container.addView(row)
            if (rowIndex == 0) container.addView(space(6))
        }
        return container
    }

    private fun slider(
        label: String,
        min: Int,
        max: Int,
        initial: Int,
        suffix: String,
        onChange: (Int) -> Unit,
    ): View {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(5), 0, dp(7))
            val valueText = bodyText("$initial$suffix", 12f, COLOR_SECONDARY, Typeface.BOLD)
            addView(LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(bodyText(label, 12.5f, COLOR_SECONDARY), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                addView(valueText)
            })
            addView(SeekBar(this@MainActivity).apply {
                this.max = max - min
                progress = initial - min
                progressTintList = ColorStateList.valueOf(color(COLOR_ACCENT))
                thumbTintList = ColorStateList.valueOf(color(COLOR_TEXT))
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(36))
                setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                    override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                        val value = progress + min
                        valueText.text = "$value$suffix"
                        onChange(value)
                    }
                    override fun onStartTrackingTouch(seekBar: SeekBar?) = Unit
                    override fun onStopTrackingTouch(seekBar: SeekBar?) = Unit
                })
            })
        }
    }

    private fun buildAndroidNote(): View {
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(View(this@MainActivity).apply { setBackgroundColor(color(COLOR_ACCENT)) }, LinearLayout.LayoutParams(dp(2), ViewGroup.LayoutParams.MATCH_PARENT))
            addView(LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(13), 0, 0, 0)
                addView(bodyText("Android limitation", 12.5f, COLOR_TEXT, Typeface.BOLD))
                addView(bodyText(
                    "Android allows a tint and dimming overlay. It does not expose system-wide RGB channel removal to regular apps.",
                    12f,
                    COLOR_MUTED,
                ).apply { setPadding(0, dp(5), 0, 0) })
            })
        }
    }

    private fun buildActions(): View {
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(actionText("Preview 15s", primary = false).apply {
                setOnClickListener { startPreview() }
            }, LinearLayout.LayoutParams(0, dp(46), 1f))
            addView(actionText("Save schedule", primary = true).apply {
                setOnClickListener { saveSchedule() }
            }, LinearLayout.LayoutParams(0, dp(46), 1f).also { it.marginStart = dp(10) })
        }
    }

    private fun buildUpdateRow(): View {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(divider())
            addView(LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, dp(15), 0, 0)
                addView(bodyText("Updates", 12f, COLOR_SECONDARY, Typeface.BOLD), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                addView(actionText("Check now", primary = false).apply {
                    setOnClickListener { ApkUpdater.check(this@MainActivity) { message -> feedback.text = message } }
                }, LinearLayout.LayoutParams(dp(112), dp(40)))
            })
        }
    }

    private fun saveSchedule() {
        val error = runCatching { ScheduleEngine.offsets(current) }.exceptionOrNull()
        if (error != null) {
            feedback.setTextColor(color("#EFAD80"))
            feedback.text = error.message ?: "Check the four schedule times."
            return
        }
        if (current.enabled && !Settings.canDrawOverlays(this)) {
            feedback.setTextColor(color("#EFAD80"))
            feedback.text = "Allow display over other apps before enabling the schedule."
            openOverlayPermission()
            return
        }
        store.save(current)
        if (current.enabled) ScreenFilterService.refresh(this) else ScreenFilterService.stop(this)
        feedback.setTextColor(color(COLOR_MUTED))
        feedback.text = "Schedule saved."
        updateScheduleStatus()
    }

    private fun startPreview() {
        if (!Settings.canDrawOverlays(this)) {
            feedback.setTextColor(color("#EFAD80"))
            feedback.text = "Allow display over other apps to run the preview."
            openOverlayPermission()
            return
        }
        val error = runCatching { ScheduleEngine.offsets(current) }.exceptionOrNull()
        if (error != null) {
            feedback.setTextColor(color("#EFAD80"))
            feedback.text = error.message ?: "Check the four schedule times."
            return
        }
        store.save(current)
        requestNotificationPermissionIfNeeded()
        ScreenFilterService.preview(this)
        feedback.setTextColor(color(COLOR_MUTED))
        feedback.text = "Preview started. 3s in, 9s full, 3s out."
    }

    private fun pickTime(key: String) {
        val parts = timeValue(key).split(":")
        TimePickerDialog(this, { _, hour, minute ->
            val value = "%02d:%02d".format(hour, minute)
            current = when (key) {
                "fadeInStart" -> current.copy(fadeInStart = value)
                "fullStart" -> current.copy(fullStart = value)
                "fadeOutStart" -> current.copy(fadeOutStart = value)
                else -> current.copy(end = value)
            }
            timeValues[key]?.text = value
            feedback.text = ""
        }, parts[0].toInt(), parts[1].toInt(), true).show()
    }

    private fun timeValue(key: String): String = when (key) {
        "fadeInStart" -> current.fadeInStart
        "fullStart" -> current.fullStart
        "fadeOutStart" -> current.fadeOutStart
        else -> current.end
    }

    private fun refreshControls() {
        scheduleSwitch.isChecked = current.enabled
        updateDayControls()
        updatePreviewSwatch()
        refreshPermissionState()
    }

    private fun updateDayControls() {
        dayControls.forEachIndexed { index, (label, marker) ->
            val active = current.days.getOrElse(index) { false }
            label.setTextColor(color(if (active) "#F28185" else COLOR_MUTED))
            marker.setBackgroundColor(color(if (active) COLOR_ACCENT else COLOR_LINE))
        }
    }

    private fun updatePreviewSwatch() {
        if (!::previewSwatch.isInitialized) return
        val warmth = current.temperature.coerceIn(-100, 100) / 100f
        val red = (current.red * (1f + warmth.coerceAtLeast(0f) * 0.12f)).toInt().coerceIn(0, 100) * 255 / 100
        val green = (current.green * (1f - kotlin.math.abs(warmth) * 0.03f)).toInt().coerceIn(0, 100) * 255 / 100
        val blue = (current.blue * (1f + (-warmth).coerceAtLeast(0f) * 0.12f)).toInt().coerceIn(0, 100) * 255 / 100
        val swatchColor = String.format("#%02X%02X%02X", red, green, blue)
        previewSwatch.background = solid(swatchColor, 4f, COLOR_LINE)
    }

    private fun refreshPermissionState() {
        val allowed = Settings.canDrawOverlays(this)
        permissionAction.visibility = if (allowed) View.GONE else View.VISIBLE
        updateScheduleStatus()
    }

    private fun updateScheduleStatus() {
        scheduleStatus.text = when {
            !Settings.canDrawOverlays(this) -> "Overlay permission required"
            !current.enabled -> "Off. The display is unchanged."
            else -> {
                val result = ScheduleEngine.evaluate(current)
                when (result.phase) {
                    ScheduleEngine.Phase.FADE_IN -> "Fading in until ${result.nextChange}"
                    ScheduleEngine.Phase.ACTIVE -> "Active until ${result.nextChange}"
                    ScheduleEngine.Phase.FADE_OUT -> "Fading out until ${result.nextChange}"
                    ScheduleEngine.Phase.IDLE -> "On. Waiting for the scheduled time."
                }
            }
        }
    }

    private fun openOverlayPermission() {
        startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                NOTIFICATION_PERMISSION_REQUEST,
            )
        }
    }

    private fun sectionHeading(title: String, subtitle: String): View {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(bodyText(title, 15f, COLOR_TEXT, Typeface.BOLD))
            addView(bodyText(subtitle, 12f, COLOR_MUTED).apply { setPadding(0, dp(5), 0, 0) })
        }
    }

    private fun bodyText(text: String, size: Float, textColor: String, style: Int = Typeface.NORMAL): TextView {
        return TextView(this).apply {
            this.text = text
            textSize = size
            setTextColor(color(textColor))
            setTypeface(typeface, style)
            includeFontPadding = false
            setLineSpacing(dp(2).toFloat(), 1f)
        }
    }

    private fun actionText(text: String, primary: Boolean): TextView {
        return bodyText(text, 12.5f, if (primary) "#FFFFFF" else COLOR_SECONDARY, Typeface.BOLD).apply {
            gravity = Gravity.CENTER
            isClickable = true
            isFocusable = true
            background = ripple(if (primary) COLOR_ACCENT else COLOR_SURFACE, 5f, if (primary) COLOR_ACCENT else COLOR_LINE)
        }
    }

    private fun divider(): View = View(this).apply {
        setBackgroundColor(color(COLOR_LINE))
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1))
    }

    private fun solid(fill: String, radius: Float, stroke: String? = null): GradientDrawable {
        return GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            setColor(color(fill))
            cornerRadius = dp(radius.toInt()).toFloat()
            if (stroke != null) setStroke(dp(1), color(stroke))
        }
    }

    private fun ripple(fill: String, radius: Float, stroke: String? = null): RippleDrawable {
        return RippleDrawable(
            ColorStateList.valueOf(color("#26FFFFFF")),
            solid(fill, radius, stroke),
            null,
        )
    }

    private fun space(height: Int): View = Space(this).apply {
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(height))
    }

    private fun color(value: String): Int = Color.parseColor(value)
    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
