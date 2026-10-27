package com.mazenmixtream.stalker;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.MediaController;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import android.widget.VideoView;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

public class StalkerActivity extends Activity {
    private static final int BG = Color.rgb(9, 10, 16);
    private static final int PANEL = Color.rgb(27, 28, 38);
    private static final int ACCENT = Color.rgb(231, 31, 47);
    private static final int WHITE = 0xfff5f5f8;
    private static final int MUTED = 0xffa3a5b5;
    private static final String STORE = "maz_stalker_portals_v1";
    private final ArrayList<JSONObject> portals = new ArrayList<>();
    private final ArrayList<JSONObject> channels = new ArrayList<>();
    private FrameLayout root;
    private EditText nameField, urlField, macField;
    private String selectedId = "";
    private String currentPortal = "";
    private String currentMac = "";
    private String apiEndpoint = "";
    private String token = "";
    private boolean playing;
    private TextView status;
    private String activeName = "";
    private static final int MAX_STALKER_PORTALS = 50;

    public static void attach(final Activity host) {
        if (host == null || host.isFinishing()) return;
        View holder = host.findViewById(android.R.id.content);
        if (!(holder instanceof ViewGroup)) return;
        ViewGroup parent = (ViewGroup) holder;
        if (parent.findViewWithTag("maz-stalker-native-entry") != null) return;
        Button launch = new Button(host);
        launch.setTag("maz-stalker-native-entry");
        launch.setText("STALKER / MAG");
        launch.setTextColor(Color.WHITE);
        launch.setTextSize(12);
        launch.setAllCaps(false);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xffc92034);
        bg.setCornerRadius(dp(host, 12));
        launch.setBackground(bg);
        launch.setElevation(dp(host, 7));
        FrameLayout.LayoutParams layout = new FrameLayout.LayoutParams(dp(host, 168), dp(host, 50), Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        layout.bottomMargin = dp(host, 16);
        if (parent instanceof FrameLayout) ((FrameLayout) parent).addView(launch, layout);
        else {
            FrameLayout wrapper = new FrameLayout(host);
            wrapper.addView(launch, layout);
            ViewGroup.LayoutParams defaultParams = new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
            parent.addView(wrapper, defaultParams);
        }
        launch.setOnClickListener(v -> {
            Intent intent = new Intent(host, StalkerActivity.class);
            host.startActivity(intent);
        });
    }

    private static int dp(Context c, float v) { return (int) (v * c.getResources().getDisplayMetrics().density + 0.5f); }

    private GradientDrawable background(int fill, int radius) {
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(fill);
        bg.setCornerRadius(dp(this, radius));
        return bg;
    }

    private TextView text(String value, int size, int color, boolean heavy) {
        TextView t = new TextView(this);
        t.setText(value);
        t.setTextColor(color);
        t.setTextSize(size);
        if (heavy) t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return t;
    }

    private LinearLayout column() {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        return c;
    }

    private void pad(View v, int all) { v.setPadding(dp(this, all), dp(this, all), dp(this, all), dp(this, all)); }

    private Button action(String value, boolean primary) {
        Button b = new Button(this);
        b.setText(value);
        b.setAllCaps(false);
        b.setTextSize(14);
        b.setTextColor(WHITE);
        b.setBackground(background(primary ? ACCENT : PANEL, 11));
        return b;
    }

    private EditText field(String hint, String value) {
        EditText e = new EditText(this);
        e.setSingleLine(true);
        e.setTextSize(15);
        e.setTextColor(WHITE);
        e.setHintTextColor(MUTED);
        e.setHint(hint);
        e.setText(value == null ? "" : value);
        e.setPadding(dp(this, 14), dp(this, 11), dp(this, 14), dp(this, 11));
        e.setBackground(background(PANEL, 10));
        e.setSelectAllOnFocus(false);
        return e;
    }

    private void gap(LinearLayout c, int height) {
        View spacer = new View(this);
        c.addView(spacer, new LinearLayout.LayoutParams(1, dp(this, height)));
    }

    private void notifyUser(String message) {
        runOnUiThread(() -> Toast.makeText(this, message, Toast.LENGTH_LONG).show());
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        restore();
        showEditor();
    }

    private void restore() {
        portals.clear();
        String s = getSharedPreferences(STORE, MODE_PRIVATE).getString("portals", "[]");
        try {
            JSONArray arr = new JSONArray(s);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject item = arr.optJSONObject(i);
                if (item != null) portals.add(item);
            }
        } catch (Exception ignored) {}
    }

    private void persist() {
        JSONArray a = new JSONArray();
        for (JSONObject p : portals) a.put(p);
        getSharedPreferences(STORE, MODE_PRIVATE).edit().putString("portals", a.toString()).apply();
    }

    private void setBase(View child) {
        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        root.addView(child, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
    }

    private void showEditor() {
        playing = false;
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout content = column();
        pad(content, 17);
        scroll.addView(content);

        TextView title = text("MazenmiXTream", 27, WHITE, true);
        content.addView(title);
        TextView subtitle = text("STALKER / MAG PORTALS", 13, ACCENT, true);
        content.addView(subtitle);
        gap(content, 10);
        TextView desc = text("Use a portal URL and a MAC address authorized by your IPTV provider. Saved on this device.", 13, MUTED, false);
        content.addView(desc);
        gap(content, 20);

        JSONObject active = find(selectedId);
        nameField = field("Playlist name", active == null ? "" : active.optString("name"));
        urlField = field("Portal URL — http://server:port/c/", active == null ? "" : active.optString("portal"));
        macField = field("MAC Address — 00:1A:79:XX:XX:XX", active == null ? "" : active.optString("mac"));
        content.addView(nameField, new LinearLayout.LayoutParams(-1, dp(this, 50)));
        gap(content, 10);
        content.addView(urlField, new LinearLayout.LayoutParams(-1, dp(this, 50)));
        gap(content, 10);
        content.addView(macField, new LinearLayout.LayoutParams(-1, dp(this, 50)));
        gap(content, 14);

        LinearLayout actions = new LinearLayout(this);
        Button save = action("Save Portal", false);
        Button connect = action("Connect & Load TV", true);
        actions.addView(save, new LinearLayout.LayoutParams(0, dp(this, 52), 1));
        View sep = new View(this);
        actions.addView(sep, new LinearLayout.LayoutParams(dp(this, 10), 1));
        actions.addView(connect, new LinearLayout.LayoutParams(0, dp(this, 52), 1));
        content.addView(actions);
        save.setOnClickListener(v -> { if (savePortal()) showEditor(); });
        connect.setOnClickListener(v -> {
            if (!savePortal()) return;
            showEditor(); // Refresh the saved count/list before network requests.
            openChannels();
        });
        gap(content, 12);
        status = text("Supports authorized Stalker/MAG Live TV portals. Existing Xtream and M3U playlists remain unchanged.", 12, MUTED, false);
        content.addView(status);
        gap(content, 22);

        TextView savedTitle = text("SAVED STALKER PLAYLISTS  •  " + portals.size() + "/" + MAX_STALKER_PORTALS, 15, WHITE, true);
        content.addView(savedTitle);
        gap(content, 8);
        Button createNew = action("+ New Stalker Playlist", false);
        content.addView(createNew, new LinearLayout.LayoutParams(-1, dp(this, 46)));
        createNew.setOnClickListener(v -> { selectedId = ""; showEditor(); });
        gap(content, 12);
        for (JSONObject p : portals) {
            String id = p.optString("id");
            Button item = action(p.optString("name", "Stalker") + "  ·  " + p.optString("mac"), false);
            item.setGravity(Gravity.CENTER_VERTICAL | Gravity.LEFT);
            item.setPadding(dp(this, 13), 0, dp(this, 8), 0);
            content.addView(item, new LinearLayout.LayoutParams(-1, dp(this, 48)));
            gap(content, 8);
            item.setOnClickListener(v -> { selectedId = id; showEditor(); });
            item.setOnLongClickListener(v -> {
                new AlertDialog.Builder(this)
                    .setTitle("Remove Stalker Playlist?")
                    .setMessage(p.optString("name"))
                    .setPositiveButton("Remove", (dialog, which) -> {
                        portals.remove(p);
                        if (id.equals(selectedId)) selectedId = "";
                        persist();
                        showEditor();
                    })
                    .setNegativeButton("Cancel", null).show();
                return true;
            });
        }
        gap(content, 40);
        setBase(scroll);
    }

    private JSONObject find(String id) {
        if (id == null || id.length() == 0) return null;
        for (JSONObject p : portals) if (id.equals(p.optString("id"))) return p;
        return null;
    }

    private boolean savePortal() {
        String name = nameField.getText().toString().trim();
        String url = urlField.getText().toString().trim();
        String mac = macField.getText().toString().trim().toUpperCase(Locale.US);
        if (!(url.startsWith("http://") || url.startsWith("https://"))) {
            notifyUser("Portal URL must begin with http:// or https://"); return false;
        }
        try { new URL(url); } catch (Exception e) { notifyUser("Invalid Portal URL"); return false; }
        if (!mac.matches("(?i)([0-9a-f]{2}:){5}[0-9a-f]{2}")) {
            notifyUser("MAC format: 00:1A:79:12:34:56"); return false;
        }
        if (name.length() == 0) name = "Stalker " + (portals.size() + 1);
        JSONObject p = find(selectedId);
        if (p == null) {
            if (portals.size() >= MAX_STALKER_PORTALS) {
                notifyUser("Maximum 50 Stalker playlists"); return false;
            }
            p = new JSONObject();
            selectedId = String.valueOf(System.currentTimeMillis()) + "-" + portals.size();
            portals.add(p);
        }
        try {
            p.put("id", selectedId);
            p.put("name", name);
            p.put("portal", url);
            p.put("mac", mac);
            persist();
            currentPortal = url;
            currentMac = mac;
            activeName = name;
            status.setText("Saved locally • " + name);
            return true;
        } catch (Exception e) {
            notifyUser("Cannot save playlist"); return false;
        }
    }

    private void openChannels() {
        status.setText("Connecting to Stalker/MAG portal…");
        channels.clear();
        token = "";
        apiEndpoint = "";
        final String url = currentPortal;
        final String mac = currentMac;
        new Thread(() -> {
            try {
                String[] endpoints = endpointCandidates(url);
                Exception lastError = null;
                boolean receivedHtml = false;
                for (String endpoint : endpoints) {
                    try {
                        JSONObject handshake = api(endpoint, mac, "", "type=stb&action=handshake&token=&JsHttpRequest=1-xml");
                        JSONObject data = getJs(handshake);
                        String value = data.optString("token");
                        if (value.length() == 0) value = handshake.optString("token");
                        if (value.length() == 0) throw new Exception("The portal did not return a valid token");
                        token = value;
                        apiEndpoint = endpoint;
                        break;
                    } catch (Exception e) {
                        lastError = e;
                        if (e.getMessage() != null && e.getMessage().contains("HTML")) receivedHtml = true;
                    }
                }
                if (token.length() == 0) {
                    String hint = receivedHtml
                        ? "Portal replied with an HTML webpage, not Stalker API JSON. Check your provider's actual MAG Portal URL."
                        : "No compatible Stalker handshake; verify portal URL, assigned MAC and portal access.";
                    throw new Exception(hint + " Checked " + endpoints.length + " API paths. Last: "
                        + (lastError == null ? "No compatible response" : lastError.getMessage()));
                }
                try { api(apiEndpoint, mac, token, "type=stb&action=get_profile&JsHttpRequest=1-xml"); } catch (Exception ignored) {}
                JSONObject root = api(apiEndpoint, mac, token, "type=itv&action=get_all_channels&JsHttpRequest=1-xml");
                JSONArray all = findDataArray(root);
                if (all == null || all.length() == 0) {
                    root = api(apiEndpoint, mac, token, "type=itv&action=get_ordered_list&genre=0&p=1&JsHttpRequest=1-xml");
                    all = findDataArray(root);
                }
                if (all == null) throw new Exception("No channels returned. Verify this MAC is active with your provider.");
                for (int i = 0; i < all.length(); i++) {
                    JSONObject item = all.optJSONObject(i);
                    if (item != null) channels.add(item);
                }
                Collections.sort(channels, Comparator.comparing(p -> p.optString("name", "").toLowerCase(Locale.US)));
                runOnUiThread(this::showChannels);
            } catch (Exception e) {
                final String message = e.getMessage();
                runOnUiThread(() -> { status.setText("Connection failed: " + message); notifyUser("Portal error: " + message); });
            }
        }).start();
    }

    private static JSONObject getJs(JSONObject r) {
        if (r == null) return new JSONObject();
        JSONObject js = r.optJSONObject("js");
        return js != null ? js : r;
    }

    private static JSONArray findDataArray(JSONObject root) {
        JSONObject js = getJs(root);
        JSONArray data = js.optJSONArray("data");
        if (data != null) return data;
        data = root.optJSONArray("data");
        if (data != null) return data;
        JSONObject wrapped = js.optJSONObject("data");
        if (wrapped != null) return wrapped.optJSONArray("data");
        return null;
    }

    private static String[] endpointCandidates(String value) throws Exception {
        String base = value.trim().replaceAll("[?#].*$", "").replaceAll("/+$", "");
        if (!(base.startsWith("https://") || base.startsWith("http://"))) {
            throw new Exception("Portal URL must begin with http:// or https://");
        }
        // If the provider gave the full API endpoint, respect it exactly.
        if (base.matches("(?i).*/(portal|load)\\.php$")) return new String[] {base};
        // Many Stalker/MAG portals expose an STB webpage at /c/, but their
        // JSON handshake lives at a separate portal.php or server/load.php.
        if (base.matches("(?i).*/c$")) base = base.substring(0, base.length() - 2);
        java.util.LinkedHashSet<String> endpoints = new java.util.LinkedHashSet<>();
        if (base.matches("(?i).*/stalker_portal$")) {
            endpoints.add(base + "/server/load.php");
            endpoints.add(base + "/portal.php");
        } else {
            endpoints.add(base + "/portal.php");
            endpoints.add(base + "/stalker_portal/server/load.php");
            endpoints.add(base + "/server/load.php");
            // Alternate vendor layouts. A returned HTML welcome/login page
            // is *not* accepted as a successful Stalker handshake.
            endpoints.add(base + "/c/portal.php");
            endpoints.add(base + "/c/server/load.php");
            endpoints.add(base + "/stalker_portal/portal.php");
        }
        return endpoints.toArray(new String[0]);
    }

    private JSONObject api(String endpoint, String mac, String bearer, String query) throws Exception {
        String suffix = endpoint.contains("?") ? "&" : "?";
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint + suffix + query).openConnection();
        connection.setConnectTimeout(13000);
        connection.setReadTimeout(20000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("Accept", "application/json, text/javascript, */*");
        connection.setRequestProperty("User-Agent", "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG254 stbapp");
        connection.setRequestProperty("X-User-Agent", "Model: MAG254; Link: Ethernet");
        connection.setRequestProperty("Cookie", "mac=" + URLEncoder.encode(mac, "UTF-8") + "; stb_lang=en; timezone=UTC");
        connection.setRequestProperty("Referer", currentPortal);
        if (bearer != null && bearer.length() > 0) connection.setRequestProperty("Authorization", "Bearer " + bearer);
        try {
            int statusCode = connection.getResponseCode();
            InputStream stream = statusCode >= 400 ? connection.getErrorStream() : connection.getInputStream();
            if (stream == null) throw new Exception("HTTP " + statusCode);
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int n;
            while ((n = stream.read(buffer)) != -1) {
                output.write(buffer, 0, n);
                if (output.size() > 14 * 1024 * 1024) throw new Exception("Portal catalog too large");
            }
            stream.close();
            String response = new String(output.toByteArray(), "UTF-8").trim();
            if (statusCode >= 400) throw new Exception("HTTP " + statusCode);
            if (response.startsWith("\ufeff")) response = response.substring(1);
            // Android JSONObject otherwise leaks the confusing exception:
            // "Value <!DOCTYPE of type java.lang.String cannot be converted..."
            if (response.startsWith("<") || response.toLowerCase(Locale.US).startsWith("<!doctype")) {
                String reason = response.toLowerCase(Locale.US).contains("cloudflare")
                    ? " (hosting/protection page)" : "";
                throw new Exception("HTTP " + statusCode + " HTML, not Stalker JSON" + reason);
            }
            if (response.length() == 0) throw new Exception("HTTP " + statusCode + " empty API response");
            if (!response.startsWith("{")) {
                throw new Exception("HTTP " + statusCode + " response is not a Stalker JSON object");
            }
            try {
                return new JSONObject(response);
            } catch (org.json.JSONException invalid) {
                throw new Exception("HTTP " + statusCode + " returned malformed Stalker JSON");
            }
        } finally { connection.disconnect(); }
    }

    private void showChannels() {
        if (isFinishing()) return;
        ScrollView scroll = new ScrollView(this);
        LinearLayout content = column();
        pad(content, 14);
        scroll.addView(content);
        TextView title = text(activeName + "  •  LIVE TV", 22, WHITE, true);
        content.addView(title);
        gap(content, 5);
        TextView count = text(channels.size() + " channels loaded", 13, MUTED, false);
        content.addView(count);
        gap(content, 8);
        Button back = action("← Back to playlists", false);
        content.addView(back, new LinearLayout.LayoutParams(-1, dp(this, 44)));
        back.setOnClickListener(v -> showEditor());
        gap(content, 12);

        final EditText search = field("Search channels", "");
        content.addView(search, new LinearLayout.LayoutParams(-1, dp(this, 49)));
        gap(content, 10);
        LinearLayout results = column();
        content.addView(results);
        fillChannels(results, "");
        search.addTextChangedListener(new android.text.TextWatcher() {
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            public void onTextChanged(CharSequence s, int start, int before, int count) {
                fillChannels(results, s.toString());
            }
            public void afterTextChanged(android.text.Editable s) {}
        });
        setBase(scroll);
    }

    private void fillChannels(LinearLayout results, String filter) {
        results.removeAllViews();
        String needle = filter.toLowerCase(Locale.US).trim();
        int shown = 0;
        for (JSONObject ch : channels) {
            String channelName = ch.optString("name", "Channel");
            if (!channelName.toLowerCase(Locale.US).contains(needle)) continue;
            Button b = action(channelName, false);
            b.setGravity(Gravity.CENTER_VERTICAL | Gravity.LEFT);
            b.setPadding(dp(this, 16), 0, dp(this, 8), 0);
            results.addView(b, new LinearLayout.LayoutParams(-1, dp(this, 52)));
            gap(results, 7);
            b.setOnClickListener(v -> playChannel(ch));
            shown++;
            if (shown > 2000) break;
        }
        if (shown == 0) results.addView(text("No matching channels", 14, MUTED, false));
    }

    private void playChannel(JSONObject channel) {
        final String command = channel.optString("cmd");
        if (command.length() == 0) { notifyUser("No stream command for this channel"); return; }
        notifyUser("Opening " + channel.optString("name", "channel"));
        new Thread(() -> {
            try {
                String q = "type=itv&action=create_link&cmd=" + URLEncoder.encode(command, "UTF-8") + "&series=0&forced_storage=undefined&disable_ad=0&download=0&JsHttpRequest=1-xml";
                JSONObject linked = api(apiEndpoint, currentMac, token, q);
                String cmd = getJs(linked).optString("cmd");
                if (cmd.length() == 0) cmd = linked.optString("cmd");
                String stream = stripCommand(cmd);
                if (!stream.startsWith("http://") && !stream.startsWith("https://")) throw new Exception("The portal returned no playable HTTP link");
                runOnUiThread(() -> startPlayer(stream, channel.optString("name", "Live TV")));
            } catch (Exception e) { notifyUser("Unable to play: " + e.getMessage()); }
        }).start();
    }

    private String stripCommand(String value) {
        if (value == null) return "";
        int h = value.indexOf("http://");
        int s = value.indexOf("https://");
        int from = h < 0 ? s : s < 0 ? h : Math.min(h, s);
        if (from < 0) return value.trim();
        String out = value.substring(from).trim();
        int space = out.indexOf(' ');
        if (space >= 0) out = out.substring(0, space);
        return out.replace("\"", "").replace("'", "");
    }

    private void startPlayer(String url, String name) {
        playing = true;
        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        FrameLayout canvas = new FrameLayout(this);
        canvas.setBackgroundColor(Color.BLACK);
        VideoView video = new VideoView(this);
        canvas.addView(video, new FrameLayout.LayoutParams(-1, -1, Gravity.CENTER));
        TextView label = text(name, 16, WHITE, true);
        FrameLayout.LayoutParams labelPos = new FrameLayout.LayoutParams(-2, dp(this, 44), Gravity.TOP | Gravity.LEFT);
        labelPos.leftMargin = dp(this, 12);
        canvas.addView(label, labelPos);
        Button exit = action("← Back", false);
        FrameLayout.LayoutParams exitPos = new FrameLayout.LayoutParams(dp(this, 105), dp(this, 48), Gravity.TOP | Gravity.RIGHT);
        canvas.addView(exit, exitPos);
        exit.setOnClickListener(v -> { video.stopPlayback(); showChannels(); });
        setBase(canvas);
        MediaController controls = new MediaController(this);
        controls.setAnchorView(video);
        video.setMediaController(controls);
        Map<String, String> headers = new HashMap<>();
        headers.put("User-Agent", "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG254 stbapp");
        video.setVideoURI(Uri.parse(url), headers);
        video.setOnPreparedListener(player -> {
            player.setScreenOnWhilePlaying(true);
            video.start();
        });
        video.setOnErrorListener((player, what, extra) -> {
            notifyUser("Playback failed (" + what + "). The stream may require another player format.");
            return true;
        });
        video.requestFocus();
        video.start();
    }

    @Override public void onBackPressed() {
        if (playing) {
            playing = false;
            getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            showChannels();
            return;
        }
        super.onBackPressed();
    }
}
