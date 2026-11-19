package com.boxcricket3d.tv

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import java.io.IOException

/**
 * Box Cricket 3D — Android TV Native WebView Wrapper Activity (Hybrid Local + Hosted)
 * - Serves bundled game files via WebViewAssetLoader (https://appassets.androidplatform.net/index.html)
 *   so it works 100% instantly with ZERO 404 errors and even OFFLINE!
 * - Also supports optional hosted server URL with automatic fallback to bundled local game on 404/offline.
 * - Zero virtual mouse cursor: forwards TV Remote D-Pad (▲ ▼ ◀ ▶), OK/Enter, and Back directly into JS.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var rootLayout: FrameLayout
    private lateinit var webView: WebView
    private lateinit var loadingOverlay: LinearLayout
    private lateinit var errorOverlay: LinearLayout
    private lateinit var errorSubtitle: TextView
    private lateinit var assetLoader: WebViewAssetLoader
    private var lastHomeBackPressMs: Long = 0L
    private var isErrorShowing: Boolean = false
    private var fellBackToLocalThisSession: Boolean = false

    companion object {
        private const val PREFS_NAME = "box_cricket_tv_prefs"
        private const val KEY_CUSTOM_URL = "custom_game_url"
        private const val LOCAL_INDEX_URL = "https://appassets.androidplatform.net/index.html"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        enableImmersiveFullscreen()

        // Custom MIME-safe asset loader so ES Modules (.js/.mjs), CSS, fonts, icons load on Android TV 6-14
        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/") { rawPath ->
                val cleanPath = rawPath.trimStart('/').ifEmpty { "index.html" }
                try {
                    val stream = assets.open(cleanPath)
                    val mime = guessMimeType(cleanPath)
                    val headers = mapOf(
                        "Access-Control-Allow-Origin" to "*",
                        "Cache-Control" to "no-cache"
                    )
                    WebResourceResponse(mime, "UTF-8", 200, "OK", headers, stream)
                } catch (_: IOException) {
                    null
                }
            }
            .build()

        rootLayout = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#090F1D"))
        }

        webView = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#090F1D"))
            setLayerType(View.LAYER_TYPE_HARDWARE, null)
            isFocusable = true
            isFocusableInTouchMode = true
            isHorizontalScrollBarEnabled = false
            isVerticalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
        }

        configureWebView(webView)
        loadingOverlay = buildLoadingOverlay()
        errorOverlay = buildErrorOverlay()

        rootLayout.addView(
            webView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )
        rootLayout.addView(loadingOverlay)
        rootLayout.addView(errorOverlay)
        setContentView(rootLayout)

        loadGameUrl()
    }

    private fun guessMimeType(path: String): String {
        val lower = path.lowercase()
        return when {
            lower.endsWith(".html") || lower.endsWith(".htm") -> "text/html"
            lower.endsWith(".js") || lower.endsWith(".mjs") -> "application/javascript"
            lower.endsWith(".css") -> "text/css"
            lower.endsWith(".json") -> "application/json"
            lower.endsWith(".webmanifest") -> "application/manifest+json"
            lower.endsWith(".svg") -> "image/svg+xml"
            lower.endsWith(".png") -> "image/png"
            lower.endsWith(".jpg") || lower.endsWith(".jpeg") -> "image/jpeg"
            lower.endsWith(".webp") -> "image/webp"
            lower.endsWith(".woff2") -> "font/woff2"
            lower.endsWith(".woff") -> "font/woff"
            lower.endsWith(".wasm") -> "application/wasm"
            lower.endsWith(".glb") -> "model/gltf-binary"
            else -> "application/octet-stream"
        }
    }

    private fun hasBundledLocalGame(): Boolean {
        return try {
            assets.open("index.html").close()
            true
        } catch (_: IOException) {
            false
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView(wv: WebView) {
        wv.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            javaScriptCanOpenWindowsAutomatically = false
            userAgentString = "$userAgentString BoxCricketAndroidTV/1.1 SmartTV"
        }

        wv.addJavascriptInterface(AndroidTvBridge(), "AndroidTvBridge")
        wv.webChromeClient = object : WebChromeClient() {}

        wv.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                val uri: Uri = request?.url ?: return null
                return assetLoader.shouldInterceptRequest(uri)
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                return false
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (!isErrorShowing) {
                    loadingOverlay.visibility = View.GONE
                    view?.evaluateJavascript(
                        """
                        (function() {
                          window.__ANDROID_TV_APK__ = true;
                          document.body && document.body.classList.add('tv-nav-active');
                          if (window.__tvDpad && typeof window.__tvDpad.focusScope === 'function') {
                            window.__tvDpad.focusScope();
                          }
                        })();
                        """.trimIndent(),
                        null
                    )
                    wv.requestFocus()
                }
            }

            override fun onReceivedHttpError(
                view: WebView?,
                request: WebResourceRequest?,
                errorResponse: WebResourceResponse?
            ) {
                super.onReceivedHttpError(view, request, errorResponse)
                if (request?.isForMainFrame == true) {
                    val code = errorResponse?.statusCode ?: 404
                    if (code >= 400) {
                        handleMainFrameFailure("Server returned HTTP $code for ${request.url}")
                    }
                }
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame == true) {
                    val desc = error?.description?.toString() ?: "Unable to connect to game server"
                    handleMainFrameFailure("Connection failed: $desc")
                }
            }
        }
    }

    private fun handleMainFrameFailure(reason: String) {
        runOnUiThread {
            if (!fellBackToLocalThisSession && hasBundledLocalGame()) {
                fellBackToLocalThisSession = true
                Toast.makeText(
                    this,
                    "Hosted server unavailable — launching built-in stadium!",
                    Toast.LENGTH_SHORT
                ).show()
                isErrorShowing = false
                errorOverlay.visibility = View.GONE
                loadingOverlay.visibility = View.VISIBLE
                webView.loadUrl(LOCAL_INDEX_URL)
            } else {
                showErrorOverlay("$reason\nURL: ${getConfiguredGameUrl()}")
            }
        }
    }

    private fun buildLoadingOverlay(): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#090F1D"))
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )

            addView(TextView(context).apply {
                text = "BOX CRICKET 3D"
                textSize = 30f
                setTextColor(Color.parseColor("#FBBF24"))
                gravity = Gravity.CENTER
                setPadding(0, 0, 0, 12)
            })

            addView(TextView(context).apply {
                text = "Loading Live 3D Stadium for Android TV..."
                textSize = 15f
                setTextColor(Color.parseColor("#CBD5E1"))
                gravity = Gravity.CENTER
                setPadding(0, 0, 0, 28)
            })

            addView(ProgressBar(context))
        }
    }

    private fun buildErrorOverlay(): LinearLayout {
        errorSubtitle = TextView(this).apply {
            text = "Please check your URL or launch the built-in offline game."
            textSize = 15f
            setTextColor(Color.parseColor("#CBD5E1"))
            gravity = Gravity.CENTER
            setPadding(48, 0, 48, 28)
        }

        val retryBtn = Button(this).apply {
            text = "RETRY / LOAD BUILT-IN GAME"
            isFocusable = true
            isFocusableInTouchMode = true
            setBackgroundColor(Color.parseColor("#22C55E"))
            setTextColor(Color.parseColor("#022C22"))
            setPadding(44, 22, 44, 22)
            setOnClickListener {
                fellBackToLocalThisSession = false
                loadGameUrl()
            }
        }

        val urlBtn = Button(this).apply {
            text = "CHANGE SERVER URL"
            isFocusable = true
            isFocusableInTouchMode = true
            setBackgroundColor(Color.parseColor("#1E293B"))
            setTextColor(Color.parseColor("#F8FAFC"))
            setPadding(44, 20, 44, 20)
            setOnClickListener { openServerUrlDialog() }
        }

        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            visibility = View.GONE
            setBackgroundColor(Color.parseColor("#090F1D"))
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )

            addView(TextView(context).apply {
                text = "CANNOT REACH STADIUM SERVER"
                textSize = 24f
                setTextColor(Color.parseColor("#FBBF24"))
                gravity = Gravity.CENTER
                setPadding(24, 0, 24, 14)
            })
            addView(errorSubtitle)
            addView(retryBtn)
            addView(View(context).apply {
                layoutParams = LinearLayout.LayoutParams(1, 18)
            })
            addView(urlBtn)
        }
    }

    private fun showErrorOverlay(message: String) {
        runOnUiThread {
            isErrorShowing = true
            loadingOverlay.visibility = View.GONE
            errorSubtitle.text = message
            errorOverlay.visibility = View.VISIBLE
            errorOverlay.getChildAt(2)?.requestFocus()
        }
    }

    private fun getConfiguredGameUrl(): String {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val custom = prefs.getString(KEY_CUSTOM_URL, null)?.trim()
        val chosen = if (!custom.isNullOrEmpty()) custom else BuildConfig.GAME_URL.trim()
        if (chosen.equals("local", ignoreCase = true) || chosen.isEmpty()) {
            return LOCAL_INDEX_URL
        }
        return chosen
    }

    private fun loadGameUrl() {
        isErrorShowing = false
        errorOverlay.visibility = View.GONE
        loadingOverlay.visibility = View.VISIBLE
        val target = getConfiguredGameUrl()
        if (target == LOCAL_INDEX_URL) {
            fellBackToLocalThisSession = true
        }
        webView.loadUrl(target)
    }

    private fun openServerUrlDialog() {
        val input = EditText(this).apply {
            setText(getConfiguredGameUrl())
            setSingleLine(true)
        }
        AlertDialog.Builder(this)
            .setTitle("Game URL (or type 'local')")
            .setMessage("Enter your deployed URL (https://...) or type local to play built-in offline APK.")
            .setView(input)
            .setPositiveButton("Save & Load") { _, _ ->
                val entered = input.text?.toString()?.trim().orEmpty()
                if (entered.equals("local", ignoreCase = true) ||
                    entered.startsWith("http://") ||
                    entered.startsWith("https://")
                ) {
                    getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                        .edit()
                        .putString(KEY_CUSTOM_URL, entered)
                        .apply()
                    fellBackToLocalThisSession = false
                    loadGameUrl()
                } else {
                    Toast.makeText(this, "Enter 'local' or an http(s):// URL", Toast.LENGTH_SHORT).show()
                }
            }
            .setNeutralButton("Use Built-In Game") { _, _ ->
                getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .putString(KEY_CUSTOM_URL, "local")
                    .apply()
                fellBackToLocalThisSession = true
                loadGameUrl()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (isErrorShowing) {
            return super.dispatchKeyEvent(event)
        }

        val action = event.action
        val keyCode = event.keyCode

        if (keyCode == KeyEvent.KEYCODE_BACK || keyCode == KeyEvent.KEYCODE_ESCAPE) {
            if (action == KeyEvent.ACTION_DOWN) {
                handleTvBackButton()
            }
            return true
        }

        val mapped: Triple<String, String, Int>? = when (keyCode) {
            KeyEvent.KEYCODE_DPAD_UP -> Triple("ArrowUp", "ArrowUp", 38)
            KeyEvent.KEYCODE_DPAD_DOWN -> Triple("ArrowDown", "ArrowDown", 40)
            KeyEvent.KEYCODE_DPAD_LEFT -> Triple("ArrowLeft", "ArrowLeft", 37)
            KeyEvent.KEYCODE_DPAD_RIGHT -> Triple("ArrowRight", "ArrowRight", 39)
            KeyEvent.KEYCODE_DPAD_CENTER,
            KeyEvent.KEYCODE_ENTER,
            KeyEvent.KEYCODE_NUMPAD_ENTER,
            KeyEvent.KEYCODE_BUTTON_A -> Triple("Enter", "Enter", 13)
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> Triple(" ", "Space", 32)
            else -> null
        }

        if (mapped != null) {
            val eventType = when (action) {
                KeyEvent.ACTION_DOWN -> "keydown"
                KeyEvent.ACTION_UP -> "keyup"
                else -> return true
            }
            dispatchJsKeyEvent(eventType, mapped.first, mapped.second, mapped.third, event.repeatCount > 0)
            return true
        }

        return super.dispatchKeyEvent(event)
    }

    private fun dispatchJsKeyEvent(type: String, key: String, code: String, keyCode: Int, repeat: Boolean) {
        val js = """
            (function() {
              var ev = new KeyboardEvent('$type', {
                key: '$key',
                code: '$code',
                keyCode: $keyCode,
                which: $keyCode,
                repeat: $repeat,
                bubbles: true,
                cancelable: true
              });
              try {
                Object.defineProperty(ev, 'keyCode', { value: $keyCode });
                Object.defineProperty(ev, 'which', { value: $keyCode });
              } catch (e) {}
              (document.activeElement || window).dispatchEvent(ev);
            })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    private fun handleTvBackButton() {
        webView.evaluateJavascript(
            """
            (function() {
              if (typeof window.__androidTvBackPress === 'function') {
                return window.__androidTvBackPress();
              }
              return 'exit';
            })();
            """.trimIndent()
        ) { result ->
            val clean = result?.replace("\"", "")?.trim() ?: "exit"
            if (clean == "home" || clean == "exit") {
                val now = SystemClock.elapsedRealtime()
                if (now - lastHomeBackPressMs < 2200L) {
                    finish()
                } else {
                    lastHomeBackPressMs = now
                    Toast.makeText(
                        this,
                        "Press Back again to exit Box Cricket 3D",
                        Toast.LENGTH_SHORT
                    ).show()
                }
            }
        }
    }

    private fun enableImmersiveFullscreen() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enableImmersiveFullscreen()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onPause() {
        webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    inner class AndroidTvBridge {
        @JavascriptInterface
        fun exitApp() {
            runOnUiThread { finish() }
        }

        @JavascriptInterface
        fun showToast(message: String) {
            runOnUiThread {
                Toast.makeText(this@MainActivity, message, Toast.LENGTH_SHORT).show()
            }
        }
    }
}
