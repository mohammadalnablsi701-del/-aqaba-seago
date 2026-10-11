package com.aqabaseago.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.google.android.gms.tasks.TaskCompletionSource;

import java.util.concurrent.atomic.AtomicBoolean;

import org.junit.Test;

public class SeaGoFirebasePluginTaskTest {
    @Test
    public void successfulTaskCompletionResolvesBarrier() {
        TaskCompletionSource<Void> source = new TaskCompletionSource<>();
        AtomicBoolean resolved = new AtomicBoolean(false);
        AtomicBoolean rejected = new AtomicBoolean(false);

        SeaGoFirebasePlugin.settleDeleteTokenTask(
            source.getTask(),
            () -> resolved.set(true),
            () -> rejected.set(true)
        );

        assertFalse(resolved.get());
        assertFalse(rejected.get());
        source.setResult(null);
        assertTrue(resolved.get());
        assertFalse(rejected.get());
    }

    @Test
    public void failedTaskCompletionRejectsBarrierSafely() {
        TaskCompletionSource<Void> source = new TaskCompletionSource<>();
        AtomicBoolean resolved = new AtomicBoolean(false);
        AtomicBoolean rejected = new AtomicBoolean(false);

        SeaGoFirebasePlugin.settleDeleteTokenTask(
            source.getTask(),
            () -> resolved.set(true),
            () -> rejected.set(true)
        );

        assertFalse(resolved.get());
        assertFalse(rejected.get());
        source.setException(new IllegalStateException("raw-fcm-token-must-not-escape"));
        assertFalse(resolved.get());
        assertTrue(rejected.get());
    }
}
