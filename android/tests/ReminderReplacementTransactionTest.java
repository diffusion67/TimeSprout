package top.dffapi.timesprout;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Standalone JVM regression checks; run with javac/java, no Android SDK needed. */
public final class ReminderReplacementTransactionTest {
    public static void main(String[] args) {
        restoresOldAlarmsAndPersistenceAfterPartialScheduleFailure();
        restoresOldAlarmWhenNewAlarmReusesItsPendingIntentIdentity();
        restoresOldAlarmsWhenPersistenceFails();
        notificationTagsKeepHashCollidingReminderIdsDistinct();
        System.out.println("Reminder replacement regression checks passed");
    }

    private static void restoresOldAlarmsAndPersistenceAfterPartialScheduleFailure() {
        List<String> active = new ArrayList<>(Arrays.asList("old-1", "old-2"));
        List<String> events = new ArrayList<>();
        ReminderReplacementTransaction.Adapter<String> adapter = new ReminderReplacementTransaction.Adapter<String>() {
            @Override public void cancel(String id) { active.remove(id); events.add("cancel:" + id); }
            @Override public void schedule(String id) {
                events.add("schedule:" + id);
                active.remove(id);
                active.add(id);
                if (id.equals("new-2")) throw new IllegalStateException("simulated failure after partial AlarmManager update");
            }
            @Override public boolean persist() { events.add("persist:new"); return true; }
            @Override public void restorePersistence() { events.add("persist:old"); }
        };

        boolean success = ReminderReplacementTransaction.replace(
                Arrays.asList("old-1", "old-2"), Arrays.asList("new-1", "new-2"), adapter);

        check(!success, "partial schedule failure must fail replacement");
        check(active.equals(Arrays.asList("old-1", "old-2")), "old alarms must be restored, got " + active);
        check(events.contains("cancel:new-1"), "partially scheduled new alarm must be cancelled");
        check(events.contains("cancel:new-2"), "failing alarm's PendingIntent must also be cancelled");
        check(events.contains("persist:old"), "persisted reminders must be restored");
    }

    private static void restoresOldAlarmWhenNewAlarmReusesItsPendingIntentIdentity() {
        List<String> scheduled = new ArrayList<>();
        scheduled.add("shared-id|old payload");
        ReminderReplacementTransaction.Adapter<String> adapter = new ReminderReplacementTransaction.Adapter<String>() {
            private String pendingIntentId(String value) { return value.substring(0, value.indexOf('|')); }
            @Override public void cancel(String value) {
                String id = pendingIntentId(value);
                scheduled.removeIf(item -> pendingIntentId(item).equals(id));
            }
            @Override public void schedule(String value) {
                String id = pendingIntentId(value);
                scheduled.removeIf(item -> pendingIntentId(item).equals(id));
                scheduled.add(value);
                if (value.contains("new payload")) throw new IllegalStateException("simulated post-update failure");
            }
            @Override public boolean persist() { return true; }
            @Override public void restorePersistence() { }
        };

        boolean success = ReminderReplacementTransaction.replace(
                Arrays.asList("shared-id|old payload"), Arrays.asList("shared-id|new payload"), adapter);

        check(!success, "overlapping PendingIntent ID failure must fail replacement");
        check(scheduled.equals(Arrays.asList("shared-id|old payload")),
                "rollback must restore the prior alarm payload for the colliding PendingIntent ID, got " + scheduled);
    }

    private static void restoresOldAlarmsWhenPersistenceFails() {
        List<String> active = new ArrayList<>(Arrays.asList("old"));
        ReminderReplacementTransaction.Adapter<String> adapter = new ReminderReplacementTransaction.Adapter<String>() {
            @Override public void cancel(String id) { active.remove(id); }
            @Override public void schedule(String id) { active.remove(id); active.add(id); }
            @Override public boolean persist() { return false; }
            @Override public void restorePersistence() { }
        };

        boolean success = ReminderReplacementTransaction.replace(
                Arrays.asList("old"), Arrays.asList("new"), adapter);

        check(!success, "failed persistence must fail replacement");
        check(active.equals(Arrays.asList("old")), "old alarm must be restored after persistence failure");
    }

    private static void notificationTagsKeepHashCollidingReminderIdsDistinct() {
        String first = "Aa";
        String second = "BB";
        check(first.hashCode() == second.hashCode(), "test IDs must collide under String.hashCode");
        check(!ReminderIdentity.notificationTag(first).equals(ReminderIdentity.notificationTag(second)),
                "notification tags must retain the full reminder ID");
    }

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
