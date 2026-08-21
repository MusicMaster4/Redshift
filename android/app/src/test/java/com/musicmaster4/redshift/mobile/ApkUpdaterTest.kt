package com.musicmaster4.redshift.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ApkUpdaterTest {
    private val manifest = """
        {
          "channel": "testing",
          "version": "1.0.1-testing.2",
          "version_code": 42,
          "url": "https://github.com/MusicMaster4/Redshift/releases/download/v1.0.1-testing.2/redshift-beta.apk",
          "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        }
    """.trimIndent()

    @Test
    fun `accepts its own channel`() {
        val update = ApkUpdater.parseManifest(manifest, "testing")
        assertEquals(42, update.versionCode)
    }

    @Test
    fun `refuses a cross channel manifest`() {
        assertThrows(IllegalArgumentException::class.java) {
            ApkUpdater.parseManifest(manifest, "stable")
        }
    }
}
