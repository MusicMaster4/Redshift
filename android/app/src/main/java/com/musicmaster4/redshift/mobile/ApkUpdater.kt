package com.musicmaster4.redshift.mobile

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

data class AndroidUpdate(
    val channel: String,
    val version: String,
    val versionCode: Int,
    val url: String,
    val sha256: String,
)

object ApkUpdater {
    private val executor = Executors.newSingleThreadExecutor()

    private fun endpoint(): String = if (BuildConfig.UPDATE_CHANNEL == "testing") {
        "https://github.com/MusicMaster4/Redshift/releases/download/channel-testing/android-latest.json"
    } else {
        "https://github.com/MusicMaster4/Redshift/releases/latest/download/android-latest.json"
    }

    fun parseManifest(body: String, expectedChannel: String): AndroidUpdate {
        val json = JSONObject(body)
        val update = AndroidUpdate(
            channel = json.getString("channel"),
            version = json.getString("version"),
            versionCode = json.getInt("version_code"),
            url = json.getString("url"),
            sha256 = json.getString("sha256").lowercase(),
        )
        require(update.channel == expectedChannel) { "Update channel mismatch" }
        require(update.url.startsWith("https://github.com/MusicMaster4/Redshift/")) { "Unexpected update host" }
        require(update.sha256.matches(Regex("[0-9a-f]{64}"))) { "Invalid update checksum" }
        return update
    }

    fun check(activity: Activity, onStatus: (String) -> Unit) {
        onStatus("Checking ${if (BuildConfig.UPDATE_CHANNEL == "testing") "beta" else "stable"} channel…")
        executor.execute {
            runCatching {
                val connection = URL(endpoint()).openConnection() as HttpURLConnection
                connection.connectTimeout = 12_000
                connection.readTimeout = 12_000
                connection.setRequestProperty("User-Agent", "Redshift-Android/${BuildConfig.VERSION_NAME}")
                connection.inputStream.bufferedReader().use { parseManifest(it.readText(), BuildConfig.UPDATE_CHANNEL) }
            }.onSuccess { update ->
                activity.runOnUiThread {
                    if (update.versionCode <= BuildConfig.VERSION_CODE) {
                        onStatus("Redshift ${BuildConfig.VERSION_NAME} is up to date.")
                    } else {
                        offer(activity, update, onStatus)
                    }
                }
            }.onFailure { error ->
                activity.runOnUiThread { onStatus(error.message ?: "Update check failed.") }
            }
        }
    }

    private fun offer(activity: Activity, update: AndroidUpdate, onStatus: (String) -> Unit) {
        AlertDialog.Builder(activity)
            .setTitle("Redshift ${update.version}")
            .setMessage("A new ${if (update.channel == "testing") "beta" else "stable"} APK is ready. Download and install it now?")
            .setNegativeButton("Later", null)
            .setPositiveButton("Install") { _, _ ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
                    onStatus("Allow Redshift to install updates, then tap Check again.")
                    activity.startActivity(
                        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")),
                    )
                } else {
                    download(activity, update, onStatus)
                }
            }
            .show()
    }

    private fun download(activity: Activity, update: AndroidUpdate, onStatus: (String) -> Unit) {
        onStatus("Downloading Redshift ${update.version}…")
        executor.execute {
            runCatching {
                val directory = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                    ?: error("The downloads folder is unavailable")
                val file = File(directory, "redshift-${update.version}.apk")
                val connection = URL(update.url).openConnection() as HttpURLConnection
                connection.connectTimeout = 20_000
                connection.readTimeout = 30_000
                connection.setRequestProperty("User-Agent", "Redshift-Android/${BuildConfig.VERSION_NAME}")
                connection.inputStream.use { input -> file.outputStream().use { output -> input.copyTo(output) } }
                val digest = MessageDigest.getInstance("SHA-256")
                val checksum = file.inputStream().use { input ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read <= 0) break
                        digest.update(buffer, 0, read)
                    }
                    digest.digest().joinToString("") { "%02x".format(it) }
                }
                if (checksum != update.sha256) {
                    file.delete()
                    error("The downloaded APK did not match its signed release checksum")
                }
                file
            }.onSuccess { file ->
                activity.runOnUiThread {
                    onStatus("Opening Android's installer…")
                    val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.files", file)
                    activity.startActivity(
                        Intent(Intent.ACTION_VIEW).apply {
                            setDataAndType(uri, "application/vnd.android.package-archive")
                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                        },
                    )
                }
            }.onFailure { error ->
                activity.runOnUiThread { onStatus(error.message ?: "Could not download the update.") }
            }
        }
    }
}
