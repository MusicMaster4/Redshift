package com.musicmaster4.redshift.mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Settings

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        if (SettingsStore(context).load().enabled && Settings.canDrawOverlays(context)) {
            ScreenFilterService.refresh(context)
        }
    }
}
