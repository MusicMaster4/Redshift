import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.musicmaster4.redshift.mobile"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.musicmaster4.redshift.mobile"
        minSdk = 26
        targetSdk = 36
        versionCode = (providers.gradleProperty("redshiftVersionCode").orNull ?: "1").toInt()
        versionName = providers.gradleProperty("redshiftVersionName").orNull ?: "1.0.0"
        val updateChannel = providers.gradleProperty("redshiftChannel").orNull ?: "stable"
        require(updateChannel == "stable" || updateChannel == "testing") {
            "redshiftChannel must be stable or testing"
        }
        buildConfigField("String", "UPDATE_CHANNEL", "\"$updateChannel\"")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    val releaseKeystore = System.getenv("REDSHIFT_ANDROID_KEYSTORE")
    val releaseStorePassword = System.getenv("REDSHIFT_ANDROID_STORE_PASSWORD")
    val releaseKeyAlias = System.getenv("REDSHIFT_ANDROID_KEY_ALIAS")
    val releaseKeyPassword = System.getenv("REDSHIFT_ANDROID_KEY_PASSWORD")
    val releaseSigning = if (
        releaseKeystore != null && releaseStorePassword != null &&
        releaseKeyAlias != null && releaseKeyPassword != null
    ) {
        signingConfigs.create("redshiftRelease") {
            storeFile = file(releaseKeystore)
            storePassword = releaseStorePassword
            keyAlias = releaseKeyAlias
            keyPassword = releaseKeyPassword
        }
    } else null

    buildTypes {
        release {
            signingConfig = releaseSigning
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.core:core-ktx:1.17.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
}
