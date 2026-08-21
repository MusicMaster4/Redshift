package com.musicmaster4.redshift.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.view.View
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import kotlin.math.roundToInt

class ScreenFilterService : Service() {
    companion object {
        const val ACTION_REFRESH = "com.musicmaster4.redshift.mobile.REFRESH"
        const val ACTION_PREVIEW = "com.musicmaster4.redshift.mobile.PREVIEW"
        const val ACTION_STOP = "com.musicmaster4.redshift.mobile.STOP"
        private const val CHANNEL_ID = "redshift-schedule"
        private const val NOTIFICATION_ID = 2140

        fun refresh(context: android.content.Context) {
            val intent = Intent(context, ScreenFilterService::class.java).setAction(ACTION_REFRESH)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: android.content.Context) {
            context.startService(Intent(context, ScreenFilterService::class.java).setAction(ACTION_STOP))
        }

        fun preview(context: android.content.Context) {
            val intent = Intent(context, ScreenFilterService::class.java).setAction(ACTION_PREVIEW)
            ContextCompat.startForegroundService(context, intent)
        }
    }

    private lateinit var store: SettingsStore
    private lateinit var windowManager: WindowManager
    private var overlay: TintOverlay? = null
    private var previewStartedAt: Long? = null
    private var nextDelayMs = 60_000L
    private var lastNotificationDetail: String? = null
    private val handler = Handler(Looper.getMainLooper())
    private val tick = object : Runnable {
        override fun run() {
            updateOverlay()
            handler.postDelayed(this, nextDelayMs)
        }
    }

    override fun onCreate() {
        super.onCreate()
        store = SettingsStore(this)
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        createNotificationChannel()
        startForegroundCompat(buildNotification())
        ensureOverlay()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            previewStartedAt = null
            val current = store.load()
            store.save(current.copy(enabled = false))
            stopSelf()
            return START_NOT_STICKY
        }
        if (intent?.action == ACTION_PREVIEW) {
            if (!Settings.canDrawOverlays(this)) {
                stopSelf()
                return START_NOT_STICKY
            }
            previewStartedAt = SystemClock.elapsedRealtime()
            ensureOverlay()
            restartTick()
            return START_NOT_STICKY
        }
        if (!store.load().enabled) {
            stopSelf()
            return START_NOT_STICKY
        }
        ensureOverlay()
        restartTick()
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startForegroundCompat(notification: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, 0)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun ensureOverlay() {
        if (overlay != null || !Settings.canDrawOverlays(this)) return
        val view = TintOverlay()
        val parameters = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            parameters.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        windowManager.addView(view, parameters)
        overlay = view
    }

    private fun updateOverlay() {
        val settings = store.load()
        previewStartedAt?.let { startedAt ->
            val elapsed = SystemClock.elapsedRealtime() - startedAt
            if (elapsed < ScheduleEngine.PREVIEW_DURATION_MS) {
                overlay?.update(settings, ScheduleEngine.previewIntensity(elapsed))
                nextDelayMs = 50L
                notifyStatus(previewing = true)
                return
            }
            previewStartedAt = null
            overlay?.update(settings, 0f)
            if (!settings.enabled) {
                stopSelf()
                return
            }
        }
        if (!settings.enabled) {
            stopSelf()
            return
        }
        ensureOverlay()
        val result = ScheduleEngine.evaluate(settings)
        overlay?.update(settings, result.intensity)
        nextDelayMs = when (result.phase) {
            ScheduleEngine.Phase.FADE_IN, ScheduleEngine.Phase.FADE_OUT -> 1_000L
            ScheduleEngine.Phase.ACTIVE, ScheduleEngine.Phase.IDLE -> untilNextMinute()
        }
        notifyStatus(result)
    }

    private fun restartTick() {
        handler.removeCallbacks(tick)
        handler.post(tick)
    }

    private fun untilNextMinute(): Long {
        val elapsed = System.currentTimeMillis().mod(60_000L)
        return (60_000L - elapsed).coerceAtLeast(25L)
    }

    private fun notifyStatus(result: ScheduleEngine.Result? = null, previewing: Boolean = false) {
        val detail = notificationDetail(result, previewing)
        if (detail == lastNotificationDetail) return
        lastNotificationDetail = detail
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, buildNotification(result, previewing))
    }

    private fun createNotificationChannel() {
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, getString(R.string.notification_channel), NotificationManager.IMPORTANCE_LOW).apply {
                description = "Keeps Redshift's screen schedule running"
                setShowBadge(false)
            },
        )
    }

    private fun buildNotification(
        result: ScheduleEngine.Result? = null,
        previewing: Boolean = false,
    ): Notification {
        val openIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val stopIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, ScreenFilterService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val detail = notificationDetail(result, previewing)
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(ContextCompat.getColor(this, R.color.redshift_accent))
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(detail)
            .setContentIntent(openIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .addAction(0, getString(R.string.notification_stop), stopIntent)
            .build()
    }

    private fun notificationDetail(
        result: ScheduleEngine.Result? = null,
        previewing: Boolean = false,
    ): String = when {
            previewing -> "Preview: 3s in, 9s full, 3s out"
            result?.phase == ScheduleEngine.Phase.FADE_IN -> "Fading in${result.nextChange?.let { " until $it" } ?: ""}"
            result?.phase == ScheduleEngine.Phase.ACTIVE -> "Screen tint active${result.nextChange?.let { " until $it" } ?: ""}"
            result?.phase == ScheduleEngine.Phase.FADE_OUT -> "Fading out${result.nextChange?.let { " until $it" } ?: ""}"
            else -> "Waiting for the next scheduled scene"
        }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        overlay?.let { view -> runCatching { windowManager.removeView(view) } }
        overlay = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    private inner class TintOverlay : View(this) {
        private var darknessAlpha = 0
        private var tintAlpha = 0
        private var tintColor = Color.RED

        fun update(settings: MobileSettings, timelineIntensity: Float) {
            val amount = timelineIntensity.coerceIn(0f, 1f) * settings.strength.coerceIn(0, 100) / 100f
            visibility = if (amount <= 0.001f) GONE else VISIBLE
            darknessAlpha = (settings.darkness.coerceIn(0, 100) / 100f * 0.76f * amount * 255f).roundToInt()
            tintAlpha = (0.5f * amount * 255f).roundToInt()
            val warmth = settings.temperature.coerceIn(-100, 100) / 100f
            val red = (settings.red.coerceIn(0, 100) / 100f * 255f * (1f + warmth.coerceAtLeast(0f) * 0.12f)).roundToInt().coerceIn(0, 255)
            val green = (settings.green.coerceIn(0, 100) / 100f * 255f * (1f - kotlin.math.abs(warmth) * 0.03f)).roundToInt().coerceIn(0, 255)
            val blue = (settings.blue.coerceIn(0, 100) / 100f * 255f * (1f + (-warmth).coerceAtLeast(0f) * 0.12f)).roundToInt().coerceIn(0, 255)
            tintColor = Color.rgb(red, green, blue)
            invalidate()
        }

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            if (darknessAlpha > 0) canvas.drawColor(Color.argb(darknessAlpha, 0, 0, 0))
            if (tintAlpha > 0) canvas.drawColor(Color.argb(tintAlpha, Color.red(tintColor), Color.green(tintColor), Color.blue(tintColor)))
        }
    }
}
