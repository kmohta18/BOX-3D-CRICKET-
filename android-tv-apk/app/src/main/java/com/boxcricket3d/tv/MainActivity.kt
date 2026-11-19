package com.boxcricket3d.tv

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Context
import android.graphics.Color
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

/**
 * Box Cricket 3D — Hosted Android TV Wrapper Activity
 * - Zero virtual mouse cursor: forwards TV Remote D-Pad (▲ ▼ ◀ ▶), OK/Enter, and Back
 *   directly into the web game's spatial D-Pad & live batting engine.
 * - Fullscreen immersive mode + keep-screen-on + hardware-accelerated WebGL & autoplay audio.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var rootLayout: FrameLayout
    private lateinit var webView: WebView
    private lateinit var loadingOverlay: LinearLayout
    private lateinit var errorOverlay: LinearLayout
    private lateinit var errorSubtitle: TextView
    private var lastHomeBackPressMs: Long = 0L
    private var isErrorShowing: Boolean = false

    companion object {
        private const val PREFS_NAME = "box_cricket_tv_prefs"
        private const val KEY_CUSTOM_URL = "custom_game_url"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Keep TV screen awake during matches & enter true fullscreen immersive mode
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        enableImmersiveFullscreen()

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
            // Clean Chrome-compatible UA with SmartTV marker so game auto-enables TV D-Pad mode
            userAgentString = "$userAgentString BoxCricketAndroidTV/1.0 SmartTV"
        }

        wv.addJavascriptInterface(AndroidTvBridge(), "AndroidTvBridge")

        wv.webChromeClient = object : WebChromeClient() {}

        wv.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                // Keep in-app navigation inside WebView
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

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame == true) {
                    val desc = error?.description?.toString() ?: "Unable to connect to game server"
                    showErrorOverlay("Connection failed: $desc\nURL: ${getConfiguredGameUrl()}")
                }
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
            text = "Please check your TV Wi-Fi connection and press Retry."
            textSize = 15f
            setTextColor(Color.parseColor("#CBD5E1"))
            gravity = Gravity.CENTER
            setPadding(48, 0, 48, 28)
        }

        val retryBtn = Button(this).apply {
            text = "RETRY CONNECTION"
            isFocusable = true
            isFocusableInTouchMode = true
            setBackgroundColor(Color.parseColor("#22C55E"))
            setTextColor(Color.parseColor("#022C22"))
            setPadding(44, 22, 44, 22)
            setOnClickListener { loadGameUrl() }
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
        return if (!custom.isNullOrEmpty()) custom else BuildConfig.GAME_URL
    }

    private fun loadGameUrl() {
        isErrorShowing = false
        errorOverlay.visibility = View.GONE
        loadingOverlay.visibility = View.VISIBLE
        webView.loadUrl(getConfiguredGameUrl())
    }

    private fun openServerUrlDialog() {
        val input = EditText(this).apply {
            setText(getConfiguredGameUrl())
            setSingleLine(true)
        }
        AlertDialog.Builder(this)
            .setTitle("Hosted Game URL")
            .setMessage("Enter your deployed Box Cricket 3D URL (https://... or http://192.168.x.x:3000)")
            .setView(input)
            .setPositiveButton("Save & Load") { _, _ ->
                val entered = input.text?.toString()?.trim().orEmpty()
                if (entered.startsWith("http://") || entered.startsWith("https://")) {
                    getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                        .edit()
                        .putString(KEY_CUSTOM_URL, entered)
                        .apply()
                    loadGameUrl()
                } else {
                    Toast.makeText(this, "URL must start with http:// or https://", Toast.LENGTH_SHORT).show()
                }
            }
            .setNeutralButton("Reset Default") { _, _ ->
                getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .remove(KEY_CUSTOM_URL)
                    .apply()
                loadGameUrl()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    /**
     * Native Android TV Remote Bridge:
     * Forwards D-Pad ▲▼◀▶, OK/Select, and Back directly into JS so Android TV WebView
     * never triggers virtual mouse pointer mode and responds with zero lag.
     */
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
