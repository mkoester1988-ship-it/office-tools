package de.mircokoester.pdfreaderstudio;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Base64;
import com.getcapacitor.BridgeActivity;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        handleOpenIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleOpenIntent(intent);
    }

    private void handleOpenIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return;
        Uri uri = intent.getData();
        if (uri == null) return;

        try {
            String fileName = "Dokument.pdf";
            try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (idx >= 0) fileName = cursor.getString(idx);
                }
            }
            String mimeType = getContentResolver().getType(uri);
            if (mimeType == null) mimeType = "application/pdf";

            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            try (InputStream is = getContentResolver().openInputStream(uri)) {
                if (is == null) return;
                byte[] buf = new byte[8192];
                int n;
                while ((n = is.read(buf)) > 0) {
                    baos.write(buf, 0, n);
                }
            }
            String base64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);

            JSONObject payload = new JSONObject();
            payload.put("name", fileName);
            payload.put("mimeType", mimeType);
            payload.put("base64", base64);

            final String js = "window.dispatchEvent(new CustomEvent('android-open-file', { detail: " + payload.toString() + " }));";
            getBridge().getWebView().postDelayed(() -> {
                getBridge().getWebView().evaluateJavascript(js, null);
            }, 900);
        } catch (Exception ignored) {
        }
    }
}
