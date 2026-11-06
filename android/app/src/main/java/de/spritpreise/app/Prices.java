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
import android.os.PowerManager;
import android.text.SpannableString;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.TextUtils;
import android.text.format.DateUtils;
import android.text.style.ForegroundColorSpan;
import android.text.style.RelativeSizeSpan;
import android.text.style.SuperscriptSpan;
import android.view.View;
import android.util.Log;
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
    private static final String PREFS = "bg", CFG = "cfg", STATE = "alarmState", CHANNEL = "alarm", STATUS = "status";
    /** Intent-Aktion: App bei einer Tankstelle öffnen (Widget-Zeile, Benachrichtigung). */
    static final String OPEN = "de.spritpreise.app.OPEN";
    private static final String LIST = "https://creativecommons.tankerkoenig.de/json/list.php";
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
            if (p != null && p.optLong("t") > obj(cur, id).optLong("t")) cur.put(id, merge(cur.optJSONObject(id), p));
        }
        put(c, PRICES, cur);
        put(c, CFG, cfg);
        updateWidgets(c);
        schedule(c);
    }

    /** Neuer Preis mit Trend: je Sorte die letzte Änderung (Differenz und Zeitpunkt), bis sich wieder etwas ändert. */
    private static JSONObject merge(JSONObject old, JSONObject nu) throws JSONException {
        JSONObject chg = old == null ? new JSONObject() : obj(old, "chg");
        for (String f : FUELS) {
            if (old == null || !old.has(f) || !nu.has(f)) continue;
            double d = nu.optDouble(f) - old.optDouble(f);
            if (Math.abs(d) > 0.0005) chg.put(f, new JSONObject().put("d", d).put("t", nu.optLong("t")));
        }
        nu.put("chg", chg);
        return nu;
    }

    /** Umkreis-Alarm eingeschaltet und vollständig (Mittelpunkt und Grenze)? */
    private static boolean areaAlarm(JSONObject cfg) {
        JSONObject a = obj(cfg, "area");
        return a.optBoolean("on") && a.has("lat") && a.has("lng") && a.optDouble("below", 0) > 0;
    }

    /** Umkreis wird gebraucht: für den Alarm oder für die Zeile im Widget (nur, wenn ein Widget existiert). */
    private static boolean areaUsed(Context c, JSONObject cfg) {
        JSONObject a = obj(cfg, "area");
        return areaAlarm(cfg) || a.optBoolean("wid") && a.has("lat") && a.has("lng") && widgetIds(c).length > 0;
    }

    /** Kennung des Umkreises: ändern sich Mittelpunkt, Radius oder Sorte, gilt das alte Ergebnis nicht mehr. */
    private static String areaKey(JSONObject a) {
        return a.optDouble("lat") + "|" + a.optDouble("lng") + "|" + Math.max(1, Math.min(25, a.optInt("rad", 10)))
                + "|" + a.optString("fuel", "e5");
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

    /** Plant die regelmäßige Abfrage nur, wenn es etwas zu tun gibt (Key und Alarm oder Widget).
     *  Fehler beim Planen (z. B. vom System verweigert) dürfen die App nie abstürzen lassen. */
    static void schedule(Context c) {
        try {
            planPeriodic(c);
            note(c, "planErr", "");
        } catch (RuntimeException e) {
            Log.w("Spritpreise", "Hintergrundabfrage nicht geplant", e);
            note(c, "planErr", String.valueOf(e.getMessage()));
        }
    }

    private static void planPeriodic(Context c) {
        JobScheduler js = c.getSystemService(JobScheduler.class);
        JSONObject cfg = json(c, CFG);
        int minutes = cfg.optInt("interval", 30);
        boolean need = !cfg.optString("key").isEmpty() && minutes > 0 && (areaUsed(c, cfg) || !ids(cfg).isEmpty()
                && (obj(cfg, "alarms").length() > 0 || widgetIds(c).length > 0));
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
        try {
            c.getSystemService(JobScheduler.class).schedule(new JobInfo.Builder(JOB_NOW, new ComponentName(c, PriceJob.class))
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .build());
        } catch (RuntimeException e) {
            Log.w("Spritpreise", "Sofortabfrage nicht geplant", e);
        }
    }

    /** Im Hintergrund: Preise holen (je 10 Stationen pro Anfrage), Alarme prüfen, Widgets aktualisieren,
     *  Umkreis-Alarm prüfen. Liefert die Zahl der abgefragten Stationen, -1 wenn nichts zu tun war. */
    static synchronized int refresh(Context c) throws IOException, JSONException {
        JSONObject cfg = json(c, CFG);
        String key = cfg.optString("key");
        List<String> ids = ids(cfg);
        if (key.isEmpty() || ids.isEmpty() && !areaUsed(c, cfg)) return -1;
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
                cur.put(id, merge(cur.optJSONObject(id), o));
            }
        }
        put(c, PRICES, cur);
        JSONObject old = json(c, STATE), state = new JSONObject();
        checkAlarms(c, cfg, cur, old, state);
        // Zustand des Umkreis-Alarms behalten, falls dessen Abfrage scheitert (sonst käme die Meldung doppelt)
        for (Iterator<String> it = old.keys(); it.hasNext(); ) {
            String k = it.next();
            if (k.startsWith("area|")) state.put(k, old.optBoolean(k));
        }
        try {
            checkArea(c, cfg, key, old, state);
        } finally {
            put(c, STATE, state);
            updateWidgets(c);
        }
        return ids.size();
    }

    /** Umkreis: günstigste geöffnete Tankstelle im Umkreis (eine Abfrage), für die Widget-Zeile gemerkt.
     *  Der Alarm meldet einmal, erneut erst, nachdem der Preis wieder über der Grenze lag. */
    private static void checkArea(Context c, JSONObject cfg, String key, JSONObject old, JSONObject state)
            throws IOException, JSONException {
        if (!areaUsed(c, cfg)) return;
        JSONObject a = obj(cfg, "area");
        String fuel = a.optString("fuel", "e5");
        double below = a.optDouble("below"), lat = a.optDouble("lat"), lng = a.optDouble("lng");
        int rad = Math.max(1, Math.min(25, a.optInt("rad", 10)));
        JSONObject r = new JSONObject(get(LIST + "?lat=" + lat + "&lng=" + lng + "&rad=" + rad + "&sort=price&type=" + fuel
                + "&apikey=" + URLEncoder.encode(key, "UTF-8")));
        if (!r.optBoolean("ok")) throw new IOException(r.optString("message", "API-Fehler"));
        JSONArray st = r.optJSONArray("stations");
        JSONObject best = null;
        for (int i = 0; st != null && i < st.length(); i++) {
            JSONObject s = st.optJSONObject(i);
            if (s == null || !s.optBoolean("isOpen", true)) continue;
            double p = s.optDouble("price", 0);
            if (p > 0 && (best == null || p < best.optDouble("price"))) best = s;
        }
        String sk = "area|" + lat + "|" + lng + "|" + rad + "|" + fuel + "|" + below;
        boolean was = old.optBoolean(sk);
        state.remove(sk);
        if (best == null) {
            if (was) state.put(sk, true);
            return;
        }
        double v = best.optDouble("price");
        String brand = best.optString("brand").trim(), place = best.optString("place").trim();
        if (brand.isEmpty()) brand = best.optString("name", "Tankstelle").trim();
        note(c, "area", brand + " " + euro(v));
        note(c, "areaBest", new JSONObject().put("n", brand + (place.isEmpty() ? "" : " " + place)).put("p", v)
                .put("id", best.optString("id")).put("lat", best.optDouble("lat")).put("lng", best.optDouble("lng"))
                .put("fuel", fuel).put("k", areaKey(a)).put("t", System.currentTimeMillis()));
        if (!areaAlarm(cfg)) return;
        if (v <= below + 1e-9) {
            if (!was) notifyArea(c, best, fuel, v, below);
            state.put(sk, true);
        } else if (v <= below + 0.0049 && was) {
            state.put(sk, true);
        }
    }

    /** Ein Wert im Status für die Anzeige in den Einstellungen. */
    static void note(Context c, String k, Object v) {
        try {
            JSONObject s = json(c, STATUS);
            s.put(k, v);
            put(c, STATUS, s);
        } catch (JSONException e) {
            // Status ist nur Anzeige
        }
    }

    /** Ergebnis eines Hintergrundlaufs merken (err == null: erfolgreich, n: Zahl der Stationen). */
    static void ran(Context c, String err, int n) {
        try {
            JSONObject s = json(c, STATUS);
            s.put("run", System.currentTimeMillis());
            s.put("err", err == null ? "" : err);
            if (err == null) s.put("n", n);
            put(c, STATUS, s);
        } catch (JSONException e) {
            // Status ist nur Anzeige
        }
    }

    /** Für die Einstellungen: letzter Lauf, Planung und die Systemfreigaben, die der Hintergrund braucht. */
    static String status(Context c) {
        JSONObject s = json(c, STATUS);
        try {
            JobInfo p = c.getSystemService(JobScheduler.class).getPendingJob(JOB_PERIODIC);
            s.put("planned", p != null ? p.getIntervalMillis() / 60_000L : 0);
            s.put("notify", c.getSystemService(NotificationManager.class).areNotificationsEnabled());
            s.put("battery", c.getSystemService(PowerManager.class).isIgnoringBatteryOptimizations(c.getPackageName()));
            s.put("widgets", widgetIds(c).length);
            s.put("maker", Build.MANUFACTURER);
        } catch (JSONException | RuntimeException e) {
            // Unvollständiger Status ist besser als keiner
        }
        return s.toString();
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
    private static void checkAlarms(Context c, JSONObject cfg, JSONObject cur, JSONObject old, JSONObject state)
            throws JSONException {
        JSONObject alarms = obj(cfg, "alarms");
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
    }

    private static String fuelName(String f) {
        return "e5".equals(f) ? "E5" : "e10".equals(f) ? "E10" : "Diesel";
    }

    private static String euro(double v) {
        return String.format(Locale.GERMANY, "%.3f", v);
    }

    private static Notification.Builder builder(Context c) {
        if (Build.VERSION.SDK_INT >= 26) {
            c.getSystemService(NotificationManager.class).createNotificationChannel(
                    new NotificationChannel(CHANNEL, "Preisalarm", NotificationManager.IMPORTANCE_DEFAULT));
            return new Notification.Builder(c, CHANNEL);
        }
        return new Notification.Builder(c);
    }

    private static void notify(Context c, String id, JSONObject name, String fuel, double v, double below) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        Notification.Builder b = builder(c);
        String place = name.optString("p");
        b.setSmallIcon(R.drawable.ic_stat_pump)
                .setContentTitle(name.optString("n", "Tankstelle") + (place.isEmpty() ? "" : " " + place)
                        + ": " + fuelName(fuel) + " " + euro(v) + " €")
                .setContentText("Auf oder unter deiner Alarmgrenze von " + euro(below) + " €")
                .setShowWhen(true)
                .setAutoCancel(true)
                .setContentIntent(openStation(c, id, Double.NaN, Double.NaN, 1000 + (id.hashCode() & 0xffff)));
        nm.notify(id.hashCode(), b.build());
    }

    private static void notifyArea(Context c, JSONObject s, String fuel, double v, double below) {
        String brand = s.optString("brand").trim(), place = s.optString("place").trim();
        if (brand.isEmpty()) brand = s.optString("name", "Tankstelle").trim();
        Notification.Builder b = builder(c);
        b.setSmallIcon(R.drawable.ic_stat_pump)
                .setContentTitle("Umkreis: " + brand + (place.isEmpty() ? "" : " " + place)
                        + ": " + fuelName(fuel) + " " + euro(v) + " €")
                .setContentText(String.format(Locale.GERMANY, "%.1f km vom Mittelpunkt · Grenze %s €",
                        s.optDouble("dist", 0), euro(below)))
                .setShowWhen(true)
                .setAutoCancel(true)
                .setContentIntent(openStation(c, s.optString("id"), s.optDouble("lat"), s.optDouble("lng"), 900));
        c.getSystemService(NotificationManager.class).notify("area".hashCode(), b.build());
    }

    /** App bei einer Tankstelle öffnen: Favorit in der Liste, sonst Karte an der Position (lat/lng). */
    static PendingIntent openStation(Context c, String id, double lat, double lng, int req) {
        Intent i = new Intent(c, MainActivity.class).setAction(OPEN).putExtra("id", id)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (!Double.isNaN(lat)) i.putExtra("lat", lat).putExtra("lng", lng);
        return PendingIntent.getActivity(c, req, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static PendingIntent openApp(Context c) {
        Intent i = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        return PendingIntent.getActivity(c, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    static void updateWidgets(Context c) {
        try {
            int[] ids = widgetIds(c);
            if (ids.length > 0) AppWidgetManager.getInstance(c).updateAppWidget(ids, render(c));
        } catch (RuntimeException e) {
            Log.w("Spritpreise", "Widget nicht gezeichnet", e);
        }
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

    /** Pfeil vor dem Preis, wenn er sich in den letzten 24 Stunden geändert hat: ↓ grün, ↑ rot. */
    private static CharSequence trend(CharSequence price, JSONObject ch) {
        if (!ch.has("d") || System.currentTimeMillis() - ch.optLong("t") > 86_400_000L) return price;
        boolean down = ch.optDouble("d") < 0;
        SpannableStringBuilder sb = new SpannableStringBuilder(down ? "↓ " : "↑ ");
        sb.setSpan(new ForegroundColorSpan(down ? 0xff3ccf7a : 0xffff6b6b), 0, 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return sb.append(price);
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
                else if (p.has(fuel)) pt = trend(price(p.optDouble(fuel)), obj(obj(p, "chg"), fuel));
            }
            v.setTextViewText(VALUES[i], pt);
            v.setViewVisibility(ROWS[i], View.VISIBLE);
            v.setOnClickPendingIntent(ROWS[i], openStation(c, id, Double.NaN, Double.NaN, 100 + i));
        }
        // Zusatzzeile: günstigste im Umkreis (Ergebnis der letzten Hintergrundabfrage, höchstens 6 Stunden alt)
        JSONObject area = obj(cfg, "area"), ab = obj(json(c, STATUS), "areaBest");
        boolean showArea = area.optBoolean("wid") && ab.has("p") && areaKey(area).equals(ab.optString("k"))
                && System.currentTimeMillis() - ab.optLong("t") < 6 * 3_600_000L;
        if (showArea) {
            String af = ab.optString("fuel", fuel);
            v.setTextViewText(R.id.na, "◎ " + ab.optString("n") + (af.equals(fuel) ? "" : " · " + fuelName(af)));
            v.setTextViewText(R.id.pa, price(ab.optDouble("p")));
            v.setOnClickPendingIntent(R.id.ra, openStation(c, ab.optString("id"), ab.optDouble("lat"), ab.optDouble("lng"), 99));
            newest = Math.max(newest, ab.optLong("t"));
        }
        v.setViewVisibility(R.id.ra, showArea ? View.VISIBLE : View.GONE);
        v.setViewVisibility(R.id.empty, n == 0 && !showArea ? View.VISIBLE : View.GONE);
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
