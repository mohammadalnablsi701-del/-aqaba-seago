package com.aqabaseago.app;

import android.content.Context;
import android.content.res.Resources;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.concurrent.atomic.AtomicBoolean;

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
            Class<?> firebaseAppClass = Class.forName("com.google.firebase.FirebaseApp");
            Object firebaseApp = firebaseAppClass.getMethod("getInstance").invoke(null);
            Object options = firebaseAppClass.getMethod("getOptions").invoke(firebaseApp);
            Class<?> optionsClass = options.getClass();
            String projectId = String.valueOf(optionsClass.getMethod("getProjectId").invoke(options));
            String applicationId = String.valueOf(optionsClass.getMethod("getApplicationId").invoke(options));
            return EXPECTED_PROJECT_ID.equals(projectId) && EXPECTED_APP_ID.equals(applicationId);
        } catch (Throwable ignored) {
            return false;
        }
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
            Class<?> messagingClass = Class.forName("com.google.firebase.messaging.FirebaseMessaging");
            Object messaging = messagingClass.getMethod("getInstance").invoke(null);
            Object task = messagingClass.getMethod("deleteToken").invoke(messaging);
            Class<?> listenerClass = Class.forName("com.google.android.gms.tasks.OnCompleteListener");
            AtomicBoolean completed = new AtomicBoolean(false);
            InvocationHandler handler = (proxy, method, args) -> {
                if (!"onComplete".equals(method.getName()) || args == null || args.length != 1 || !completed.compareAndSet(false, true)) return null;
                try {
                    Object completedTask = args[0];
                    Method isSuccessful = completedTask.getClass().getMethod("isSuccessful");
                    if (Boolean.TRUE.equals(isSuccessful.invoke(completedTask))) call.resolve();
                    else call.reject("Firebase token deletion failed");
                } catch (Throwable ignored) {
                    call.reject("Firebase token deletion failed");
                }
                return null;
            };
            Object listener = Proxy.newProxyInstance(listenerClass.getClassLoader(), new Class<?>[]{listenerClass}, handler);
            task.getClass().getMethod("addOnCompleteListener", listenerClass).invoke(task, listener);
        } catch (Throwable ignored) {
            call.reject("Firebase token deletion failed");
        }
    }
}
