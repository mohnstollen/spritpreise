plugins {
    id("com.android.application")
}

// Signatur aus Umgebungsvariablen (GitHub-Secrets); ohne sie wird mit dem Debug-Schlüssel signiert
val keystoreFile: String? = System.getenv("KEYSTORE_FILE")

android {
    namespace = "de.spritpreise.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "de.spritpreise.app"
        minSdk = 24
        targetSdk = 35
        versionCode = (System.getenv("VERSION_CODE") ?: "1").toInt()
        versionName = System.getenv("VERSION_NAME")?.takeIf { it.isNotEmpty() }?.removePrefix("v")
            ?: ("1.0." + (System.getenv("VERSION_CODE") ?: "0"))
    }

    signingConfigs {
        create("release") {
            if (keystoreFile != null) {
                storeFile = file(keystoreFile)
                storePassword = System.getenv("KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KEY_ALIAS")
                keyPassword = System.getenv("KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName(if (keystoreFile != null) "release" else "debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        // Lint läuft als eigener Schritt im Workflow (gradle lintRelease), nicht bei jedem assembleRelease
        checkReleaseBuilds = false
        abortOnError = true
        textReport = true
        textOutput = file("stdout")
    }

    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/web"))
}

// Die PWA-Dateien aus dem Repo-Stamm (und Leaflet aus android/vendor, falls vorhanden) als Assets einbinden
val copyWeb = tasks.register<Copy>("copyWeb") {
    from(rootDir.parentFile) {
        include("index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png")
        into("www")
    }
    from(rootProject.file("vendor")) {
        into("vendor")
    }
    into(layout.buildDirectory.dir("generated/web"))
}
tasks.named("preBuild") { dependsOn(copyWeb) }

dependencies {
    // Beleg-Scan: Texterkennung auf dem Gerät, das Modell kommt über die Google-Play-Dienste (kleine APK)
    implementation("com.google.android.gms:play-services-mlkit-text-recognition:19.0.1")
    // FileProvider für das Kamerafoto
    implementation("androidx.core:core:1.13.1")
}
