package de.spritpreise.app;

import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.graphics.Rect;
import android.net.Uri;
import android.provider.MediaStore;

import androidx.core.content.FileProvider;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;

/**
 * Beleg-Scan fürs Tank-Logbuch: Foto per Kamera oder aus der Galerie, Texterkennung auf dem Gerät
 * (ML Kit über die Google-Play-Dienste, das Foto verlässt das Handy nicht). Ergebnis: jede erkannte
 * Zeile mit Position, damit die Web-App Spalten wie „Gesamtbetrag … 76,04 EUR“ wieder zusammensetzen kann.
 */
final class Receipt {
    interface Done {
        void result(String json, String err);
    }

    private Receipt() {}

    static File photo(Context c) {
        File d = new File(c.getCacheDir(), "scan");
        if (!d.isDirectory() && !d.mkdirs()) d = c.getCacheDir();
        return new File(d, "beleg.jpg");
    }

    static Uri photoUri(Context c) {
        return FileProvider.getUriForFile(c, c.getPackageName() + ".scan", photo(c));
    }

    /** Auswahl: Galerie, dazu die Kamera als erste Möglichkeit. */
    static Intent chooser(Context c) {
        File f = photo(c);
        if (f.exists() && !f.delete()) f.deleteOnExit();
        Uri out = photoUri(c);
        Intent cam = new Intent(MediaStore.ACTION_IMAGE_CAPTURE)
                .putExtra(MediaStore.EXTRA_OUTPUT, out)
                .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        cam.setClipData(ClipData.newRawUri("", out));
        Intent pick = new Intent(Intent.ACTION_GET_CONTENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE);
        return Intent.createChooser(pick, "Kassenbeleg").putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{cam});
    }

    /** Ergebnis der Auswahl: Galeriebild aus data, sonst das Kamerafoto (falls es geschrieben wurde). */
    static Uri picked(Context c, Intent data) {
        if (data != null && data.getData() != null) return data.getData();
        File f = photo(c);
        return f.length() > 0 ? photoUri(c) : null;
    }

    static void recognize(Context c, Uri uri, Done done) {
        InputImage img;
        try {
            img = InputImage.fromFilePath(c, uri);
        } catch (IOException e) {
            done.result(null, "Foto nicht lesbar");
            return;
        }
        TextRecognizer r = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        r.process(img)
                .addOnSuccessListener(t -> {
                    JSONArray a = new JSONArray();
                    for (Text.TextBlock b : t.getTextBlocks()) {
                        for (Text.Line l : b.getLines()) {
                            Rect bb = l.getBoundingBox();
                            if (bb == null) continue;
                            try {
                                a.put(new JSONObject().put("t", l.getText()).put("x", bb.left).put("y", bb.centerY()).put("h", bb.height()));
                            } catch (JSONException e) {
                                // einzelne Zeile auslassen
                            }
                        }
                    }
                    r.close();
                    done.result(a.toString(), null);
                })
                .addOnFailureListener(e -> {
                    r.close();
                    done.result(null, e.getMessage() != null ? e.getMessage() : "Texterkennung fehlgeschlagen");
                });
    }
}
