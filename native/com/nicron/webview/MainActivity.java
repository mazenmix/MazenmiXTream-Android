package com.nicron.webview;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.SurfaceTexture;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.Surface;
import android.view.TextureView;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.VideoSize;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.hls.DefaultHlsExtractorFactory;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy;
import androidx.media3.extractor.DefaultExtractorsFactory;
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

public final class MainActivity extends Activity {
    private static final String PROXY_HOST = "mx.local";
    private FrameLayout rootView;
    private WebView webView;
    private TextureView nativeVideoView;
    private Surface nativeVideoSurface;
    private ExoPlayer nativePlayer;
    private Handler mainHandler;
    private String pendingNativeUrl;
    private String pendingNativeHeadersJson;
    private int nativeGeneration;
    private int nativeVideoWidth;
    private int nativeVideoHeight;
    private String nativeAspect = "contain";
    private float nativeVolume = 1f;
    private boolean nativeMuted;
    private boolean nativeFirstFrame;
    private boolean resumeNativeOnResume;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;

    @SuppressLint({"SetJavaScriptEnabled", "AllowFileAccessFromFileURLs"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED);

        mainHandler = new Handler(Looper.getMainLooper());
        rootView = new FrameLayout(this);
        rootView.setBackgroundColor(Color.BLACK);

        nativeVideoView = new TextureView(this);
        nativeVideoView.setOpaque(true);
        nativeVideoView.setSurfaceTextureListener(new TextureView.SurfaceTextureListener() {
            @Override
            public void onSurfaceTextureAvailable(SurfaceTexture surfaceTexture, int width, int height) {
                releaseNativeSurface();
                nativeVideoSurface = new Surface(surfaceTexture);
                if (nativePlayer != null) nativePlayer.setVideoSurface(nativeVideoSurface);
                applyNativeAspect();
                if (pendingNativeUrl != null) startNativePlayer(pendingNativeUrl, nativeGeneration, pendingNativeHeadersJson);
            }

            @Override
            public void onSurfaceTextureSizeChanged(SurfaceTexture surfaceTexture, int width, int height) {
                applyNativeAspect();
            }

            @Override
            public boolean onSurfaceTextureDestroyed(SurfaceTexture surfaceTexture) {
                if (nativePlayer != null) nativePlayer.clearVideoSurface();
                releaseNativeSurface();
                return true;
            }

            @Override
            public void onSurfaceTextureUpdated(SurfaceTexture surfaceTexture) {
            }
        });
        rootView.addView(nativeVideoView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.TRANSPARENT);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        rootView.addView(webView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(rootView, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUserAgentString(settings.getUserAgentString() + " MazenmiXTream/1.1.6 AndroidTV");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) settings.setOffscreenPreRaster(true);

        webView.addJavascriptInterface(new NetworkBridge(), "MazenNetwork");
        webView.addJavascriptInterface(new NativePlayerBridge(), "MazenPlayer");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri != null && PROXY_HOST.equalsIgnoreCase(uri.getHost())) return proxyRequest(request);
                return super.shouldInterceptRequest(view, request);
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                customView = view;
                customViewCallback = callback;
                webView.setVisibility(View.GONE);
                rootView.addView(customView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            }

            @Override
            public void onHideCustomView() {
                hideCustomView();
            }
        });

        webView.loadUrl("file:///android_asset/index.html");
        webView.requestFocus(View.FOCUS_DOWN);
    }

    @Override
    public void onBackPressed() {
        if (customView != null) {
            hideCustomView();
        } else if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        if (webView != null && (code == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE || code == KeyEvent.KEYCODE_CHANNEL_UP || code == KeyEvent.KEYCODE_CHANNEL_DOWN || code == KeyEvent.KEYCODE_MEDIA_NEXT || code == KeyEvent.KEYCODE_MEDIA_PREVIOUS)) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                String button = code == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE ? "playPauseBtn" : code == KeyEvent.KEYCODE_CHANNEL_UP || code == KeyEvent.KEYCODE_MEDIA_NEXT ? "nextBtn" : "prevBtn";
                webView.evaluateJavascript("var b=document.getElementById('" + button + "');if(b)b.click();", null);
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    protected void onPause() {
        resumeNativeOnResume = nativePlayer != null && nativePlayer.isPlaying();
        if (resumeNativeOnResume) {
            try { nativePlayer.pause(); } catch (Exception ignored) {}
        }
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
        if (resumeNativeOnResume && nativePlayer != null) {
            try {
                nativePlayer.play();
                emitPlayerEvent("playing", nativeGeneration, "");
            } catch (Exception ignored) {}
        }
        resumeNativeOnResume = false;
    }

    @Override
    protected void onDestroy() {
        releaseNativePlayer();
        releaseNativeSurface();
        if (mainHandler != null) mainHandler.removeCallbacksAndMessages(null);
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private void hideCustomView() {
        if (customView == null) return;
        customView.setVisibility(View.GONE);
        rootView.removeView(customView);
        customView = null;
        webView.setVisibility(View.VISIBLE);
        if (customViewCallback != null) customViewCallback.onCustomViewHidden();
        customViewCallback = null;
    }

    private void playNative(final String url, final int generation, final String headersJson) {
        if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) {
            emitPlayerEvent("error", generation, "Invalid stream URL");
            return;
        }
        nativeGeneration = generation;
        pendingNativeUrl = url;
        pendingNativeHeadersJson = headersJson;
        nativeFirstFrame = false;
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                if (nativeVideoSurface != null && nativeVideoSurface.isValid()) startNativePlayer(url, generation, headersJson);
            }
        });
    }

    private void startNativePlayer(final String url, final int generation, final String headersJson) {
        if (generation != nativeGeneration || nativeVideoSurface == null || !nativeVideoSurface.isValid()) return;
        pendingNativeUrl = url;
        pendingNativeHeadersJson = headersJson;
        nativeFirstFrame = false;
        nativeVideoWidth = nativeVideoHeight = 0;
        try {
            ensureNativePlayer();
            nativePlayer.setVideoSurface(nativeVideoSurface);
            nativePlayer.setVolume(nativeMuted ? 0f : nativeVolume);

            Map<String, String> headers = new HashMap<>();
            headers.put("User-Agent", "VLC/3.0.21 LibVLC/3.0.21 MazenmiXTream/1.1.6");
            headers.put("Accept", "*/*");
            headers.put("Icy-MetaData", "1");
            headers.putAll(parseNativeHeaders(headersJson));

            DefaultHttpDataSource.Factory httpFactory = new DefaultHttpDataSource.Factory()
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(6500)
                .setReadTimeoutMs(15000)
                .setUserAgent(headers.get("User-Agent"))
                .setDefaultRequestProperties(headers);
            int tsFlags = DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS
                | DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES;
            MediaItem mediaItem = new MediaItem.Builder().setUri(Uri.parse(url)).build();
            DefaultLoadErrorHandlingPolicy retryPolicy = new DefaultLoadErrorHandlingPolicy(1);
            MediaSource mediaSource;
            if (isHlsUrl(url)) {
                mediaSource = new HlsMediaSource.Factory(httpFactory)
                    .setExtractorFactory(new DefaultHlsExtractorFactory(tsFlags, true))
                    .setAllowChunklessPreparation(true)
                    .setLoadErrorHandlingPolicy(retryPolicy)
                    .createMediaSource(mediaItem);
            } else {
                DefaultExtractorsFactory extractorsFactory = new DefaultExtractorsFactory().setTsExtractorFlags(tsFlags);
                mediaSource = new ProgressiveMediaSource.Factory(httpFactory, extractorsFactory)
                    .setLoadErrorHandlingPolicy(retryPolicy)
                    .createMediaSource(mediaItem);
            }
            emitPlayerEvent("bufferingStart", generation, "");
            nativePlayer.setMediaSource(mediaSource, true);
            nativePlayer.prepare();
            nativePlayer.play();
            startNativeProgressLoop(generation);
        } catch (Exception error) {
            stopNativePlayback();
            emitPlayerEvent("error", generation, readableNativeError(error));
        }
    }

    private void ensureNativePlayer() {
        if (nativePlayer != null) return;
        DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
            .setBufferDurationsMs(2500, 18000, 250, 750)
            .setPrioritizeTimeOverSizeThresholds(true)
            .build();
        DefaultRenderersFactory renderersFactory = new DefaultRenderersFactory(this).setEnableDecoderFallback(true);
        nativePlayer = new ExoPlayer.Builder(this, renderersFactory).setLoadControl(loadControl).build();
        nativePlayer.setHandleAudioBecomingNoisy(true);
        nativePlayer.setWakeMode(C.WAKE_MODE_NETWORK);
        if (nativeVideoSurface != null && nativeVideoSurface.isValid()) nativePlayer.setVideoSurface(nativeVideoSurface);
        nativePlayer.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int playbackState) {
                int generation = nativeGeneration;
                if (playbackState == Player.STATE_BUFFERING) {
                    emitPlayerEvent("bufferingStart", generation, "");
                } else if (playbackState == Player.STATE_READY) {
                    emitPlayerEvent("prepared", generation, "");
                    emitPlayerEvent("bufferingEnd", generation, "");
                } else if (playbackState == Player.STATE_ENDED) {
                    emitPlayerEvent("ended", generation, "");
                }
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                emitPlayerEvent("error", nativeGeneration, readableNativeError(error));
            }

            @Override
            public void onVideoSizeChanged(VideoSize videoSize) {
                nativeVideoWidth = videoSize.width;
                nativeVideoHeight = videoSize.height;
                applyNativeAspect();
            }

            @Override
            public void onRenderedFirstFrame() {
                emitFirstNativeFrame(nativeGeneration);
            }

        });
    }

    private void emitFirstNativeFrame(int generation) {
        if (generation != nativeGeneration || nativeFirstFrame) return;
        nativeFirstFrame = true;
        emitPlayerEvent("playing", generation, "");
    }

    private void startNativeProgressLoop(final int generation) {
        mainHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (nativePlayer == null || generation != nativeGeneration || pendingNativeUrl == null) return;
                try {
                    long duration = nativePlayer.getDuration();
                    long position = nativePlayer.getCurrentPosition();
                    if (duration > 0 && position >= 0) emitPlayerEvent("progress", generation, position + "," + duration);
                } catch (Exception ignored) {}
                mainHandler.postDelayed(this, 1000L);
            }
        }, 1000L);
    }

    private static boolean isHlsUrl(String url) {
        String lower = url == null ? "" : url.toLowerCase();
        return lower.contains(".m3u8") || lower.contains("/hls/") || lower.contains("output=m3u8");
    }

    private static Map<String, String> parseNativeHeaders(String json) {
        Map<String, String> headers = new HashMap<>();
        if (json == null || json.trim().isEmpty()) return headers;
        try {
            JSONObject object = new JSONObject(json);
            Iterator<String> keys = object.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                String lower = key == null ? "" : key.toLowerCase();
                if (lower.equals("host") || lower.equals("content-length") || lower.equals("connection")) continue;
                String value = object.optString(key, "");
                if (!key.trim().isEmpty() && !value.isEmpty()) headers.put(key, value);
            }
        } catch (Exception ignored) {}
        return headers;
    }

    private void releaseNativePlayer() {
        ExoPlayer player = nativePlayer;
        nativePlayer = null;
        nativeFirstFrame = false;
        if (player == null) return;
        try { player.stop(); } catch (Exception ignored) {}
        try { player.clearVideoSurface(); } catch (Exception ignored) {}
        try { player.release(); } catch (Exception ignored) {}
    }

    private void stopNativePlayback() {
        pendingNativeUrl = null;
        pendingNativeHeadersJson = null;
        nativeFirstFrame = false;
        nativeVideoWidth = nativeVideoHeight = 0;
        if (nativePlayer == null) return;
        try { nativePlayer.stop(); } catch (Exception ignored) {}
        try { nativePlayer.clearMediaItems(); } catch (Exception ignored) {}
    }

    private void releaseNativeSurface() {
        if (nativeVideoSurface != null) {
            try { nativeVideoSurface.release(); } catch (Exception ignored) {}
            nativeVideoSurface = null;
        }
    }

    private void applyNativeAspect() {
        if (nativeVideoView == null || nativeVideoWidth <= 0 || nativeVideoHeight <= 0 || nativeVideoView.getWidth() <= 0 || nativeVideoView.getHeight() <= 0) return;
        float viewRatio = (float) nativeVideoView.getWidth() / (float) nativeVideoView.getHeight();
        float videoRatio = (float) nativeVideoWidth / (float) nativeVideoHeight;
        float scaleX = 1f;
        float scaleY = 1f;
        if ("contain".equals(nativeAspect)) {
            if (videoRatio > viewRatio) scaleY = viewRatio / videoRatio;
            else scaleX = videoRatio / viewRatio;
        } else if ("cover".equals(nativeAspect)) {
            if (videoRatio > viewRatio) scaleX = videoRatio / viewRatio;
            else scaleY = viewRatio / videoRatio;
        }
        Matrix matrix = new Matrix();
        matrix.setScale(scaleX, scaleY, nativeVideoView.getWidth() / 2f, nativeVideoView.getHeight() / 2f);
        nativeVideoView.setTransform(matrix);
    }

    private void emitPlayerEvent(final String type, final int generation, final String detail) {
        if (webView == null) return;
        webView.post(new Runnable() {
            @Override
            public void run() {
                if (webView == null) return;
                String script = "window.MazenNativePlayerEvent&&window.MazenNativePlayerEvent(" + JSONObject.quote(type) + "," + generation + "," + JSONObject.quote(detail == null ? "" : detail) + ");";
                webView.evaluateJavascript(script, null);
            }
        });
    }

    private static String readableNativeError(Throwable error) {
        String code = error instanceof PlaybackException ? ((PlaybackException) error).getErrorCodeName() : error.getClass().getSimpleName();
        Throwable cause = error.getCause();
        String detail = cause != null && cause.getMessage() != null ? cause.getMessage() : error.getMessage();
        if (detail == null || detail.trim().isEmpty()) return code;
        if (detail.length() > 180) detail = detail.substring(0, 180);
        return code + ": " + detail;
    }

    private static WebResourceResponse proxyRequest(WebResourceRequest request) {
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            return response(204, "No Content", "text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]), corsHeaders());
        }
        HttpURLConnection connection = null;
        try {
            Uri uri = request.getUrl();
            String path = uri.getEncodedPath();
            if (path == null || path.length() < 3) return errorResponse(400, "Invalid proxy URL");
            String route = path.startsWith("/") ? path.substring(1) : path;
            int split = route.indexOf('/');
            if (split <= 0) return errorResponse(400, "Invalid proxy route");
            String scheme = route.substring(0, split).toLowerCase();
            if (!"http".equals(scheme) && !"https".equals(scheme)) return errorResponse(400, "Unsupported URL scheme");
            String upstream = scheme + "://" + route.substring(split + 1);
            if (uri.getEncodedQuery() != null) upstream += "?" + uri.getEncodedQuery();

            connection = (HttpURLConnection) new URL(upstream).openConnection();
            connection.setInstanceFollowRedirects(true);
            connection.setConnectTimeout(30000);
            connection.setReadTimeout(240000);
            connection.setUseCaches(false);
            connection.setRequestMethod(request.getMethod());
            connection.setRequestProperty("Accept", "application/json, application/x-mpegURL, text/plain, */*");
            connection.setRequestProperty("Accept-Language", "en-US,en;q=0.9");
            connection.setRequestProperty("User-Agent", "VLC/3.0.21 LibVLC/3.0.21 MazenmiXTream/1.1.6");
            for (Map.Entry<String, String> header : request.getRequestHeaders().entrySet()) {
                String name = header.getKey();
                if (name == null || "host".equalsIgnoreCase(name) || "origin".equalsIgnoreCase(name) || "connection".equalsIgnoreCase(name) || "accept-encoding".equalsIgnoreCase(name) || "user-agent".equalsIgnoreCase(name)) continue;
                connection.setRequestProperty(name, header.getValue());
            }

            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            if (stream == null) stream = new ByteArrayInputStream(new byte[0]);
            String contentType = connection.getContentType();
            String mime = "application/octet-stream";
            String encoding = null;
            if (contentType != null) {
                String[] parts = contentType.split(";");
                if (parts.length > 0 && !parts[0].trim().isEmpty()) mime = parts[0].trim();
                for (String part : parts) {
                    String trimmed = part.trim();
                    if (trimmed.toLowerCase().startsWith("charset=")) encoding = trimmed.substring(8).replace("\"", "");
                }
            }
            Map<String, String> headers = corsHeaders();
            for (Map.Entry<String, List<String>> header : connection.getHeaderFields().entrySet()) {
                if (header.getKey() == null || header.getValue() == null || header.getValue().isEmpty()) continue;
                String name = header.getKey();
                if ("connection".equalsIgnoreCase(name) || "transfer-encoding".equalsIgnoreCase(name) || "content-length".equalsIgnoreCase(name) || "content-encoding".equalsIgnoreCase(name) || name.toLowerCase().startsWith("access-control-")) continue;
                headers.put(name, join(header.getValue()));
            }
            String reason = status >= 200 && status < 400 ? "OK" : "Upstream Error";
            return response(status, reason, mime, encoding, new DisconnectingInputStream(stream, connection), headers);
        } catch (Exception error) {
            if (connection != null) connection.disconnect();
            return errorResponse(502, error.getClass().getSimpleName() + ": " + String.valueOf(error.getMessage()));
        }
    }

    private static Map<String, String> corsHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
        headers.put("Access-Control-Allow-Headers", "Range, Cache-Control, Pragma, Content-Type, Accept, Origin, User-Agent");
        headers.put("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, Content-Type");
        headers.put("Cache-Control", "no-store");
        return headers;
    }

    private static WebResourceResponse errorResponse(int status, String message) {
        byte[] bytes;
        try { bytes = message.getBytes("UTF-8"); } catch (Exception ignored) { bytes = message.getBytes(); }
        return response(status, "Network Error", "text/plain", "UTF-8", new ByteArrayInputStream(bytes), corsHeaders());
    }

    private static WebResourceResponse response(int status, String reason, String mime, String encoding, InputStream stream, Map<String, String> headers) {
        return new WebResourceResponse(mime, encoding, status, reason, headers, stream);
    }

    private static String join(List<String> values) {
        StringBuilder builder = new StringBuilder();
        for (String value : values) {
            if (builder.length() > 0) builder.append(", ");
            builder.append(value);
        }
        return builder.toString();
    }

    private static String toProxyUrl(String url) {
        if (url == null) return "";
        if (url.startsWith("http://")) return "https://" + PROXY_HOST + "/http/" + url.substring(7);
        if (url.startsWith("https://")) return "https://" + PROXY_HOST + "/https/" + url.substring(8);
        return url;
    }

    private final class NativePlayerBridge {
        @JavascriptInterface
        public boolean isAvailable() {
            return true;
        }

        @JavascriptInterface
        public void play(final String url, final int generation) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    playNative(url, generation, "");
                }
            });
        }

        @JavascriptInterface
        public void playWithHeaders(final String url, final int generation, final String headersJson) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    playNative(url, generation, headersJson);
                }
            });
        }

        @JavascriptInterface
        public void stop() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    nativeGeneration += 1;
                    stopNativePlayback();
                    WindowManager.LayoutParams attributes = getWindow().getAttributes();
                    attributes.screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE;
                    getWindow().setAttributes(attributes);
                }
            });
        }

        @JavascriptInterface
        public void pause() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (nativePlayer == null) return;
                    try {
                        nativePlayer.pause();
                        emitPlayerEvent("paused", nativeGeneration, "");
                    } catch (Exception ignored) {}
                }
            });
        }

        @JavascriptInterface
        public void resume() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (nativePlayer == null) return;
                    try {
                        nativePlayer.play();
                        emitPlayerEvent(nativeFirstFrame ? "playing" : "prepared", nativeGeneration, "");
                    } catch (Exception ignored) {}
                }
            });
        }

        @JavascriptInterface
        public void seekBy(final int seconds) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (nativePlayer == null) return;
                    try {
                        long duration = nativePlayer.getDuration();
                        long target = Math.max(0L, nativePlayer.getCurrentPosition() + seconds * 1000L);
                        if (duration > 0) target = Math.min(duration, target);
                        nativePlayer.seekTo(target);
                    } catch (Exception ignored) {}
                }
            });
        }

        @JavascriptInterface
        public void seekToFraction(final float fraction) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (nativePlayer == null) return;
                    try {
                        long duration = nativePlayer.getDuration();
                        if (duration > 0) nativePlayer.seekTo((long) (duration * Math.max(0f, Math.min(1f, fraction))));
                    } catch (Exception ignored) {}
                }
            });
        }

        @JavascriptInterface
        public void setMuted(final boolean muted) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    nativeMuted = muted;
                    if (nativePlayer != null) {
                        float volume = muted ? 0f : nativeVolume;
                        try { nativePlayer.setVolume(volume); } catch (Exception ignored) {}
                    }
                }
            });
        }

        @JavascriptInterface
        public void setVolume(final float volume) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    nativeVolume = Math.max(0f, Math.min(1f, volume));
                    nativeMuted = false;
                    if (nativePlayer != null) {
                        try { nativePlayer.setVolume(nativeVolume); } catch (Exception ignored) {}
                    }
                }
            });
        }

        @JavascriptInterface
        public void setAspect(final String aspect) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    nativeAspect = "cover".equals(aspect) || "fill".equals(aspect) ? aspect : "contain";
                    applyNativeAspect();
                }
            });
        }

        @JavascriptInterface
        public void setViewport(final int left, final int top, final int width, final int height) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (nativeVideoView == null || width <= 0 || height <= 0) return;
                    FrameLayout.LayoutParams layout = new FrameLayout.LayoutParams(width, height);
                    layout.leftMargin = Math.max(0, left);
                    layout.topMargin = Math.max(0, top);
                    nativeVideoView.setLayoutParams(layout);
                    nativeVideoView.setTransform(new Matrix());
                    nativeVideoView.requestLayout();
                    nativeVideoView.post(new Runnable() {
                        @Override
                        public void run() {
                            applyNativeAspect();
                        }
                    });
                }
            });
        }

        @JavascriptInterface
        public void resetViewport() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (nativeVideoView == null) return;
                    nativeVideoView.setLayoutParams(new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                    nativeVideoView.setTransform(new Matrix());
                    nativeVideoView.requestLayout();
                    nativeVideoView.post(new Runnable() {
                        @Override
                        public void run() {
                            applyNativeAspect();
                        }
                    });
                }
            });
        }

        @JavascriptInterface
        public void setBrightness(final float brightness) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    WindowManager.LayoutParams attributes = getWindow().getAttributes();
                    attributes.screenBrightness = Math.max(0.05f, Math.min(1f, brightness));
                    getWindow().setAttributes(attributes);
                }
            });
        }
    }

    private static final class NetworkBridge {
        @JavascriptInterface
        public String proxyUrl(String url) {
            return toProxyUrl(url);
        }
    }

    private static final class DisconnectingInputStream extends FilterInputStream {
        private final HttpURLConnection connection;

        DisconnectingInputStream(InputStream stream, HttpURLConnection connection) {
            super(stream);
            this.connection = connection;
        }

        @Override
        public void close() throws IOException {
            try { super.close(); } finally { connection.disconnect(); }
        }
    }
}
