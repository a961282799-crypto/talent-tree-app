package com.tao.talenttree;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import androidx.core.content.pm.PackageInfoCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.HttpsURLConnection;

@CapacitorPlugin(name = "AppUpdates")
public class AppUpdatesPlugin extends Plugin {
    private static final String DOWNLOAD = "https://github.com/a961282799-crypto/talent-tree-app/releases/download/";
    private static final String VERSION = "(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)";
    private final AtomicBoolean installing = new AtomicBoolean();

    @PluginMethod
    public void install(PluginCall call) {
        String version = call.getString("version", "");
        String sha256 = call.getString("sha256", "");
        int size = call.getInt("size", 0);
        if (!version.matches(VERSION) || !sha256.matches("[a-f0-9]{64}") || size <= 0) {
            call.reject("Invalid update");
            return;
        }
        if (!installing.compareAndSet(false, true)) {
            call.reject("An update is already in progress");
            return;
        }
        if (canInstall()) {
            downloadAndInstall(call);
            return;
        }
        Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + getContext().getPackageName()));
        getActivity().runOnUiThread(() -> {
            try {
                startActivityForResult(call, settings, "installPermission");
            } catch (Exception error) {
                installing.set(false);
                call.reject("Could not open installation settings", "permission-denied");
            }
        });
    }

    @ActivityCallback
    private void installPermission(PluginCall call, ActivityResult result) {
        if (call != null && canInstall()) {
            downloadAndInstall(call);
        } else {
            installing.set(false);
            if (call != null) call.reject("Installation permission was not granted", "permission-denied");
        }
    }

    private boolean canInstall() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls();
    }

    private void downloadAndInstall(PluginCall call) {
        new Thread(() -> {
            File apk = new File(getContext().getCacheDir(), "talent-tree-update.apk");
            try {
                String version = call.getString("version");
                download(apk, version, call.getString("sha256"), call.getInt("size"));
                checkPackage(apk, version);
                getActivity().runOnUiThread(() -> openInstaller(call, apk));
            } catch (Exception error) {
                apk.delete();
                installing.set(false);
                call.reject("Unable to download or verify the update", error);
            }
        }, "talent-tree-update").start();
    }

    private void openInstaller(PluginCall call, File apk) {
        try {
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            apk.delete();
            call.reject("Unable to open the Android installer", error);
        } finally {
            installing.set(false);
        }
    }

    private void checkPackage(File apk, String version) throws Exception {
        PackageManager manager = getContext().getPackageManager();
        String packageName = getContext().getPackageName();
        PackageInfo current = manager.getPackageInfo(packageName, 0);
        PackageInfo next = manager.getPackageArchiveInfo(apk.getAbsolutePath(), 0);
        // The system installer checks the APK's signing identity before replacing the app.
        if (next == null || !packageName.equals(next.packageName) || !version.equals(next.versionName) ||
            PackageInfoCompat.getLongVersionCode(next) <= PackageInfoCompat.getLongVersionCode(current)) {
            throw new IOException("The APK is not a newer build of this app");
        }
    }

    private void download(File apk, String version, String expectedDigest, int expectedSize) throws Exception {
        URL url = new URL(DOWNLOAD + "v" + version + "/talent-tree-" + version + ".apk");
        HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
        long received = 0;
        try {
            if (connection.getResponseCode() != 200) throw new IOException("APK download failed");
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(apk)) {
                byte[] buffer = new byte[65536];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    received += count;
                    if (received > expectedSize) throw new IOException("Unexpected APK size");
                    sha256.update(buffer, 0, count);
                    output.write(buffer, 0, count);
                }
            }
        } finally {
            connection.disconnect();
        }
        StringBuilder digest = new StringBuilder(64);
        for (byte value : sha256.digest()) {
            digest.append(Character.forDigit((value & 0xff) >>> 4, 16));
            digest.append(Character.forDigit(value & 0xf, 16));
        }
        if (received != expectedSize || !expectedDigest.contentEquals(digest)) throw new IOException("APK verification failed");
    }
}
