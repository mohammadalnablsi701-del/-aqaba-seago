package com.aqabaseago.app;

import android.content.Context;
import android.content.res.Resources;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.tasks.Task;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

@CapacitorPlugin(name = "SeaGoFirebase")
public class SeaGoFirebasePlugin extends Plugin {
    private static final String EXPECTED_PACKAGE = "com.aqabaseago.app";
    private static final String EXPECTED_PROJECT_ID = "aqaba-seago-7c92";
    private static final String EXPECTED_APP_ID = "1:173154283669:android:3553d4df3e888968772b9c";

    private boolean hasExpectedResources() {
        Context context = getContext();
        if (context == null || !EXPECTED_PACKAGE.equals(context.getPackageName())) return false;
        Resources resources = context.getResources();
        int appIdResource = resources.getIdentifier("google_app_id", "string", context.getPackageName());
        int projectIdResource = resources.getIdentifier("project_id", "string", context.getPackageName());
        if (appIdResource == 0 || projectIdResource == 0) return false;
        try {
            return EXPECTED_APP_ID.equals(resources.getString(appIdResource)) &&
                EXPECTED_PROJECT_ID.equals(resources.getString(projectIdResource));
        } catch (Resources.NotFoundException ignored) {
            return false;
        }
    }

    private boolean isExpectedFirebaseReady() {
        if (!hasExpectedResources()) return false;
        try {
            FirebaseApp firebaseApp = FirebaseApp.getInstance();
            return EXPECTED_PROJECT_ID.equals(firebaseApp.getOptions().getProjectId()) &&
                EXPECTED_APP_ID.equals(firebaseApp.getOptions().getApplicationId());
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    static void settleDeleteTokenTask(Task<Void> task, Runnable onSuccess, Runnable onFailure) {
        task.addOnCompleteListener(Runnable::run, completedTask -> {
            if (completedTask.isSuccessful()) onSuccess.run();
            else onFailure.run();
        });
    }

    @PluginMethod
    public void isConfigured(PluginCall call) {
        JSObject result = new JSObject();
        result.put("configured", isExpectedFirebaseReady());
        call.resolve(result);
    }

    @PluginMethod
    public void deleteToken(PluginCall call) {
        if (!isExpectedFirebaseReady()) {
            call.reject("Firebase native configuration is unavailable");
            return;
        }
        try {
            Task<Void> deletion = FirebaseMessaging.getInstance().deleteToken();
            settleDeleteTokenTask(
                deletion,
                call::resolve,
                () -> call.reject("Firebase token deletion failed")
            );
        } catch (RuntimeException ignored) {
            call.reject("Firebase token deletion failed");
        }
    }
}
