package de.spritpreise.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;

/** Startbildschirm-Widget mit den Preisen der Favoriten; Antippen der Kopfzeile aktualisiert. */
public class PriceWidget extends AppWidgetProvider {
    static final String REFRESH = "de.spritpreise.app.REFRESH";

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        m.updateAppWidget(ids, Prices.render(c));
        Prices.schedule(c);
    }

    @Override
    public void onEnabled(Context c) {
        Prices.schedule(c);
        Prices.refreshSoon(c);
    }

    @Override
    public void onDisabled(Context c) {
        Prices.schedule(c);
    }

    @Override
    public void onReceive(Context c, Intent i) {
        super.onReceive(c, i);
        if (REFRESH.equals(i.getAction())) Prices.refreshSoon(c);
    }
}
