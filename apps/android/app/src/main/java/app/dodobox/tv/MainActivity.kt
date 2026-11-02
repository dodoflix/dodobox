package app.dodobox.tv

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.TextView
import java.net.Inet6Address
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Thin shell around the Dodobox web app for Android TV and Android phones.
 * Finds the server on the local network by itself (mDNS name "dodobox"), remembers it, and shows the web UI full screen.
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var status: TextView
    private val main = Handler(Looper.getMainLooper())
    private var nsd: NsdManager? = null
    private var listener: NsdManager.DiscoveryListener? = null
    private var dialog: android.app.AlertDialog? = null
    private var origin: Uri? = null
    private val prefs by lazy { getSharedPreferences("dodobox", Context.MODE_PRIVATE) }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val root = FrameLayout(this)
        web = WebView(this).apply {
            setBackgroundColor(0xFF0C0C11.toInt())
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            settings.userAgentString = settings.userAgentString + " DodoboxTV"
            webViewClient = object : WebViewClient() {
                // Links outside the Dodobox server (e.g. party chat links) open in the system browser, so Back stays in the app.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (!request.isForMainFrame) return false
                    val u = request.url
                    val o = origin
                    if (o != null && u.scheme == o.scheme && u.host.equals(o.host, true) && u.port == o.port) return false
                    try { startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (e: ActivityNotFoundException) {}
                    return true
                }
            }
            webChromeClient = WebChromeClient()
            visibility = View.INVISIBLE
        }
        status = TextView(this).apply {
            setTextColor(0xFFF6F4EF.toInt()); textSize = 22f; gravity = Gravity.CENTER
            text = "Looking for Dodobox on your network..."
        }
        root.addView(web); root.addView(status, FrameLayout.LayoutParams(-1, -1))
        setContentView(root)
        connect()
    }

    private fun connect() {
        val saved = prefs.getString("url", null)
        if (saved != null) probe(saved) { ok -> if (ok) open(saved) else discover() } else discover()
    }

    private fun probe(url: String, done: (Boolean) -> Unit) = thread {
        val ok = try {
            (URL("$url/api/health").openConnection() as HttpURLConnection).run { connectTimeout = 2500; readTimeout = 2500; responseCode == 200 }
        } catch (e: Exception) { false }
        main.post { if (!isDestroyed) done(ok) }
    }

    private fun open(url: String) {
        prefs.edit().putString("url", url).apply()
        origin = Uri.parse(url)
        stopDiscovery()
        main.removeCallbacksAndMessages(null)
        dialog?.dismiss(); dialog = null
        status.visibility = View.GONE
        web.visibility = View.VISIBLE
        web.loadUrl(url)
        web.requestFocus()
    }

    private fun discover() {
        stopDiscovery()
        main.removeCallbacksAndMessages(null)
        dialog?.dismiss(); dialog = null
        status.visibility = View.VISIBLE; web.visibility = View.INVISIBLE
        status.text = "Looking for Dodobox on your network..."
        val mgr = getSystemService(Context.NSD_SERVICE) as NsdManager
        nsd = mgr
        val l = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(t: String) {}
            override fun onDiscoveryStopped(t: String) {}
            override fun onStartDiscoveryFailed(t: String, c: Int) { main.post { askAddress() } }
            override fun onStopDiscoveryFailed(t: String, c: Int) {}
            override fun onServiceLost(s: NsdServiceInfo) {}
            override fun onServiceFound(s: NsdServiceInfo) {
                if (!s.serviceName.lowercase().contains("dodobox")) return
                mgr.resolveService(s, object : NsdManager.ResolveListener {
                    override fun onResolveFailed(i: NsdServiceInfo, c: Int) {}
                    override fun onServiceResolved(i: NsdServiceInfo) {
                        val h = i.host
                        // A link-local IPv6 address needs its scope id, which a WebView URL cannot carry.
                        if (h is Inet6Address && h.isLinkLocalAddress) return
                        val addr = if (h is Inet6Address) "[${h.hostAddress?.substringBefore('%')}]" else h.hostAddress
                        val url = "http://$addr:${i.port}"
                        main.post { open(url) }
                    }
                })
            }
        }
        listener = l
        mgr.discoverServices("_http._tcp.", NsdManager.PROTOCOL_DNS_SD, l)
        main.postDelayed({ if (web.visibility != View.VISIBLE) askAddress() }, 9000)
    }

    private fun stopDiscovery() { try { listener?.let { nsd?.stopServiceDiscovery(it) } } catch (e: Exception) {}; listener = null }

    private fun askAddress() {
        if (isFinishing || isDestroyed || web.visibility == View.VISIBLE) return
        dialog?.dismiss()
        val input = EditText(this).apply { hint = "192.168.1.20:3000"; inputType = InputType.TYPE_TEXT_VARIATION_URI; setSingleLine() }
        dialog = android.app.AlertDialog.Builder(this)
            .setTitle("Enter the address shown in Dodobox Settings")
            .setView(input)
            .setPositiveButton("Connect") { _, _ ->
                val v = input.text.toString().trim().removePrefix("http://")
                if (v.isNotEmpty()) { val url = "http://$v"; probe(url) { ok -> if (ok) open(url) else askAddress() } }
            }
            .setNegativeButton("Search again") { _, _ -> discover() }
            .show()
    }

    // The web app owns Back: it closes menus, then pages. Exit only from the home screen.
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.visibility != View.VISIBLE) { super.onBackPressed(); return }
        web.evaluateJavascript("(function(){var h=location.hash; if(h===''||h==='#/'){return 'exit'} window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})); return 'ok'})()") { r ->
            if (r?.contains("exit") == true) finish()
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean = when (keyCode) {
        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE -> {
            web.evaluateJavascript("window.dispatchEvent(new KeyboardEvent('keydown',{key:'MediaPlayPause',bubbles:true}))", null); true
        }
        else -> super.onKeyDown(keyCode, event)
    }

    override fun onDestroy() { stopDiscovery(); main.removeCallbacksAndMessages(null); dialog?.dismiss(); web.destroy(); super.onDestroy() }
}
