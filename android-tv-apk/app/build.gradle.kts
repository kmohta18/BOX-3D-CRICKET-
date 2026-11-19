plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val hostedGameUrl: String = (project.findProperty("appUrl") as String?)?.trim()?.takeIf { it.isNotEmpty() }
    ?: "local"

android {
    namespace = "com.boxcricket3d.tv"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.boxcricket3d.tv"
        minSdk = 23
        targetSdk = 34
        versionCode = 2
        versionName = "1.1.0"

        buildConfigField("String", "GAME_URL", "\"${hostedGameUrl.replace("\"", "\\\"")}\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // Uses debug signing fallback so direct sideload APKs install cleanly on Android TV
            signingConfig = signingConfigs.getByName("debug")
        }
        debug {
            isDebuggable = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.11.0")
}

val appApkName = "BoxCricket3D.apk"
val repoRootDir = rootProject.projectDir.parentFile ?: rootProject.projectDir
val apksOutputDir = repoRootDir.resolve("apks")
val rootApkTarget = repoRootDir.resolve(appApkName)
val debugApkFile = layout.buildDirectory.file("outputs/apk/debug/app-debug.apk")

val copyApkToApksFolder by tasks.registering(Copy::class) {
    description = "Copies compiled debug APK to /apks/$appApkName and /$appApkName"
    group = "build"
    from(debugApkFile)
    into(apksOutputDir)
    rename { appApkName }
    doLast {
        val copiedApk = apksOutputDir.resolve(appApkName)
        if (copiedApk.exists()) {
            copiedApk.copyTo(rootApkTarget, overwrite = true)
        }
    }
}

tasks.matching { it.name == "assembleDebug" }.configureEach {
    finalizedBy(copyApkToApksFolder)
}
