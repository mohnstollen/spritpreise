# R8 verkleinert die App (ML Kit und AndroidX bringen viel ungenutzten Code mit).

# JavaScript-Brücke: Die Web-App ruft diese Methoden über ihren Namen auf (window.Android.…),
# sie dürfen weder entfernt noch umbenannt werden.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
