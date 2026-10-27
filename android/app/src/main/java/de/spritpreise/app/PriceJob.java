package de.spritpreise.app;

import android.app.job.JobParameters;
import android.app.job.JobService;

/** Führt die Preisabfrage für Widget und Alarm außerhalb des Hauptthreads aus. */
public class PriceJob extends JobService {
    @Override
    public boolean onStartJob(JobParameters params) {
        new Thread(() -> {
            try {
                Prices.refresh(this);
            } catch (Exception e) {
                // Kein Netz oder API-Fehler: beim nächsten Lauf erneut versuchen
            }
            jobFinished(params, false);
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }
}
