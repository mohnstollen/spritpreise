package de.spritpreise.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.TextUtils;
import android.text.format.DateUtils;
import android.text.style.RelativeSizeSpan;
import android.text.style.SuperscriptSpan;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Hintergrundabfrage für Widget und Preisalarm. Die Web-App liefert per syncConfig die Konfiguration
 * (API-Key, Sorte, Widget-Favoriten, Alarme, Namen) und ihre bekannten Preise; hier werden die Preise
 * regelmäßig bei Tankerkönig abgefragt, Alarme gemeldet und Widgets gezeichnet.
 */
final class Prices {
    static final String PRICES = "prices";
    private static final String PREFS = "bg", CFG = "cfg", STATE = "alarmState", CHANNEL = "alarm";
    static final int JOB_PERIODIC = 1, JOB_NOW = 2;
    private static final String API = "https://creativecommons.tankerkoenig.de/json/prices.php";
    private static final String[] FUELS = {"e5", "e10", "diesel"};

    private Prices() {}

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static JSONObject json(Context c, String k) {
        try {
            return new JSONObject(prefs(c).getString(k, "{}"));
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    private static void put(Context c, String k, JSONObject o) {
        prefs(c).edit().putString(k, o.toString()).apply();
    }

    private static JSONObject obj(JSONObject o, String k) {
        JSONObject r = o.optJSONObject(k);
        return r != null ? r : new JSONObject();
    }

    /** Von der Web-App: Konfiguration speichern, neuere Preise übernehmen, Job planen, Widgets zeichnen. */
    static synchronized void setConfig(Context c, String raw) throws JSONException {
        JSONObject cfg = new JSONObject(raw);
        JSONObject in = obj(cfg, "prices");
        cfg.remove("prices");
        JSONObject cur = json(c, PRICES);
        for (Iterator<String> it = in.keys(); it.hasNext(); ) {
            String id = it.next();
            JSONObject p = in.optJSONObject(id);
            if (p != null && p.optLong("t") > obj(cur, id).optLong("t")) cur.put(id, p);
        }
        put(c, PRICES, cur);
        put(c, CFG, cfg);
        schedule(c);
        updateWidgets(c);
    }

    /** Alle Stationen, die im Hintergrund gebraucht werden: Widget-Favoriten und Alarme. */
    private static List<String> ids(JSONObject cfg) {
        Set<String> s = new LinkedHashSet<>();
        JSONArray w = cfg.optJSONArray("widget");
        for (int i = 0; w != null && i < w.length(); i++) s.add(w.optString(i));
        for (Iterator<String> it = obj(cfg, "alarms").keys(); it.hasNext(); ) s.add(it.next());
        s.remove("");
        return new ArrayList<>(s);
    }

    private static int[] widgetIds(Context c) {
        return AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c, PriceWidget.class));
    }

    /** Plant die regelmäßige Abfrage nur, wenn es etwas zu tun gibt (Key und Alarm oder Widget). */
    static void schedule(Context c) {
        JobScheduler js = c.getSystemService(JobScheduler.class);
        JSONObject cfg = json(c, CFG);
        int minutes = cfg.optInt("interval", 30);
        boolean need = !cfg.optString("key").isEmpty() && minutes > 0 && !ids(cfg).isEmpty()
                && (obj(cfg, "alarms").length() > 0 || widgetIds(c).length > 0);
        if (!need) {
            js.cancel(JOB_PERIODIC);
            return;
        }
        long ms = minutes * 60_000L;
        JobInfo pending = js.getPendingJob(JOB_PERIODIC);
        if (pending != null && pending.getIntervalMillis() == ms) return;
        js.schedule(new JobInfo.Builder(JOB_PERIODIC, new ComponentName(c, PriceJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(ms)
                .setPersisted(true)
                .build());
    }

    /** Einmalige Abfrage, sobald Netz da ist (Widget-Kopfzeile, neues Widget). */
    static void refreshSoon(Context c) {
        c.getSystemService(JobScheduler.class).schedule(new JobInfo.Builder(JOB_NOW, new ComponentName(c, PriceJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .build());
    }

    /** Im Hintergrund: Preise holen (je 10 Stationen pro Anfrage), Alarme prüfen, Widgets aktualisieren. */
    static synchronized void refresh(Context c) throws IOException, JSONException {
        JSONObject cfg = json(c, CFG);
        String key = cfg.optString("key");
        List<String> ids = ids(cfg);
        if (key.isEmpty() || ids.isEmpty()) return;
        JSONObject cur = json(c, PRICES);
        long t = System.currentTimeMillis();
        for (int i = 0; i < ids.size(); i += 10) {
            List<String> part = ids.subList(i, Math.min(i + 10, ids.size()));
            JSONObject r = new JSONObject(get(API + "?ids=" + TextUtils.join(",", part)
                    + "&apikey=" + URLEncoder.encode(key, "UTF-8")));
            if (!r.optBoolean("ok")) throw new IOException(r.optString("message", "API-Fehler"));
            JSONObject ps = obj(r, "prices");
            for (String id : part) {
                JSONObject p = ps.optJSONObject(id);
                if (p == null) continue;
                JSONObject o = new JSONObject();
                for (String f : FUELS) {
                    Object v = p.opt(f);
                    if (v instanceof Number) o.put(f, ((Number) v).doubleValue());
                }
                o.put("open", !"closed".equals(p.optString("status")));
                o.put("t", t);
                cur.put(id, o);
            }
        }
        put(c, PRICES, cur);
        checkAlarms(c, cfg, cur);
        updateWidgets(c);
    }

    private static String get(String url) throws IOException {
        HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
        con.setConnectTimeout(15000);
        con.setReadTimeout(15000);
        try (InputStream in = con.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        } finally {
            con.disconnect();
        }
    }

    /** Meldet einen Preis einmal, wenn er die Grenze erreicht; erneut erst, nachdem er wieder darüber lag. */
    private static void checkAlarms(Context c, JSONObject cfg, JSONObject cur) throws JSONException {
        JSONObject alarms = obj(cfg, "alarms"), old = json(c, STATE), state = new JSONObject();
        for (Iterator<String> it = alarms.keys(); it.hasNext(); ) {
            String id = it.next();
            JSONObject a = obj(alarms, id), p = cur.optJSONObject(id);
            String fuel = a.optString("fuel", "e5");
            double below = a.optDouble("below", 0);
            // Der Zustand hängt an Grenze und Sorte, damit eine geänderte Grenze neu meldet
            String sk = id + "|" + fuel + "|" + below;
            boolean was = old.optBoolean(sk);
            if (p == null || !p.has(fuel)) {
                if (was) state.put(sk, true);
                continue;
            }
            double v = p.optDouble(fuel);
            if (v <= below + 1e-9 && p.optBoolean("open", true)) {
                if (!was) notify(c, id, obj(obj(cfg, "names"), id), fuel, v, below);
                state.put(sk, true);
            } else if (v <= below + 0.0049 && was) {
                state.put(sk, true);
            }
        }
        put(c, STATE, state);
    }

    private static String fuelName(String f) {
        return "e5".equals(f) ? "E5" : "e10".equals(f) ? "E10" : "Diesel";
    }

    private static String euro(double v) {
        return String.format(Locale.GERMANY, "%.3f", v);
    }

    private static void notify(Context c, String id, JSONObject name, String fuel, double v, double below) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Preisalarm", NotificationManager.IMPORTANCE_DEFAULT));
            b = new Notification.Builder(c, CHANNEL);
        } else {
            b = new Notification.Builder(c);
        }
        String place = name.optString("p");
        b.setSmallIcon(R.drawable.ic_stat_pump)
                .setContentTitle(name.optString("n", "Tankstelle") + (place.isEmpty() ? "" : " " + place)
                        + ": " + fuelName(fuel) + " " + euro(v) + " €")
                .setContentText("Auf oder unter deiner Alarmgrenze von " + euro(below) + " €")
                .setShowWhen(true)
                .setAutoCancel(true)
                .setContentIntent(openApp(c));
        nm.notify(id.hashCode(), b.build());
    }

    private static PendingIntent openApp(Context c) {
        Intent i = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        return PendingIntent.getActivity(c, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    static void updateWidgets(Context c) {
        int[] ids = widgetIds(c);
        if (ids.length > 0) AppWidgetManager.getInstance(c).updateAppWidget(ids, render(c));
    }

    private static final int[] ROWS = {R.id.r1, R.id.r2, R.id.r3, R.id.r4, R.id.r5};
    private static final int[] NAMES = {R.id.n1, R.id.n2, R.id.n3, R.id.n4, R.id.n5};
    private static final int[] VALUES = {R.id.p1, R.id.p2, R.id.p3, R.id.p4, R.id.p5};

    /** Preis wie in der App: letzte Ziffer klein und hochgestellt. */
    private static CharSequence price(double v) {
        String s = euro(v);
        SpannableString sp = new SpannableString(s);
        sp.setSpan(new SuperscriptSpan(), s.length() - 1, s.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        sp.setSpan(new RelativeSizeSpan(0.6f), s.length() - 1, s.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return sp;
    }

    static RemoteViews render(Context c) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget);
        JSONObject cfg = json(c, CFG), cur = json(c, PRICES), names = obj(cfg, "names");
        JSONArray w = cfg.optJSONArray("widget");
        String fuel = cfg.optString("fuel", "e5");
        int n = w == null ? 0 : Math.min(ROWS.length, w.length());
        long newest = 0;
        for (int i = 0; i < ROWS.length; i++) {
            if (i >= n) {
                v.setViewVisibility(ROWS[i], View.GONE);
                continue;
            }
            String id = w.optString(i);
            JSONObject nm = obj(names, id), p = cur.optJSONObject(id);
            String place = nm.optString("p");
            v.setTextViewText(NAMES[i], nm.optString("n", "Tankstelle") + (place.isEmpty() ? "" : " · " + place));
            CharSequence pt = "–";
            if (p != null) {
                newest = Math.max(newest, p.optLong("t"));
                if (!p.optBoolean("open", true)) pt = "zu";
                else if (p.has(fuel)) pt = price(p.optDouble(fuel));
            }
            v.setTextViewText(VALUES[i], pt);
            v.setViewVisibility(ROWS[i], View.VISIBLE);
        }
        v.setViewVisibility(R.id.empty, n == 0 ? View.VISIBLE : View.GONE);
        v.setTextViewText(R.id.title, "Spritpreise · " + fuelName(fuel));
        String pattern = DateUtils.isToday(newest) ? "HH:mm" : "dd.MM. HH:mm";
        v.setTextViewText(R.id.time, newest > 0
                ? new SimpleDateFormat(pattern, Locale.GERMANY).format(new Date(newest)) + " ↻" : "↻");
        v.setOnClickPendingIntent(R.id.root, openApp(c));
        v.setOnClickPendingIntent(R.id.head, PendingIntent.getBroadcast(c, 1,
                new Intent(c, PriceWidget.class).setAction(PriceWidget.REFRESH),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        return v;
    }
}
