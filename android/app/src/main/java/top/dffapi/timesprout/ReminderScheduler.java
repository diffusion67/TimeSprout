package top.dffapi.timesprout;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONObject;
import java.text.ParsePosition;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Locale;
import java.util.List;
import java.util.Set;

final class ReminderScheduler {
    private static final String PREFS = "reminders";
    private static final String DATA = "scheduled";
    private static final String DELIVERED = "delivered";
    private ReminderScheduler() {}

    static boolean replace(Context context, String json) {
        if (json == null) return false;
        try {
            JSONArray incoming = new JSONArray(json);
            JSONArray valid = new JSONArray();
            Set<String> liveIds = new HashSet<>();
            android.content.SharedPreferences preferences = context.getSharedPreferences(PREFS, 0);
            String oldData = preferences.getString(DATA, "[]");
            Set<String> oldDelivered = new HashSet<>(preferences.getStringSet(DELIVERED, new HashSet<>()));
            Set<String> delivered = new HashSet<>(oldDelivered);
            long now = System.currentTimeMillis();
            for (int i = 0; i < incoming.length(); i++) {
                JSONObject item = incoming.optJSONObject(i);
                if (item == null) continue;
                String id = item.optString("id", "");
                String title = item.optString("title", "");
                String body = item.optString("body", "");
                long at = item.optLong("at", 0);
                if (id.isEmpty() || id.length() > 400 || title.length() > 100 || body.length() > 1000) continue;
                JSONObject normalized = rebase(item, now);
                if (normalized == null) continue;
                at = normalized.optLong("at", 0);
                if (at > now && at <= now + 8L * 86400000L) liveIds.add(id);
                if (delivered.contains(id)) continue;
                if (at <= now || at > now + 8L * 86400000L) continue;
                valid.put(normalized);
            }
            JSONArray old = new JSONArray(oldData);
            List<JSONObject> oldItems = new ArrayList<>();
            List<JSONObject> newItems = new ArrayList<>();
            for (int i = 0; i < old.length(); i++) oldItems.add(old.optJSONObject(i));
            for (int i = 0; i < valid.length(); i++) newItems.add(valid.optJSONObject(i));
            delivered.retainAll(liveIds);
            String newData = valid.toString();
            Set<String> newDelivered = delivered;
            return ReminderReplacementTransaction.replace(oldItems, newItems, new ReminderReplacementTransaction.Adapter<JSONObject>() {
                @Override public void cancel(JSONObject item) { ReminderScheduler.cancel(context, item); }
                @Override public void schedule(JSONObject item) { ReminderScheduler.schedule(context, item); }
                @Override public boolean persist() {
                    return preferences.edit().putString(DATA, newData).putStringSet(DELIVERED, newDelivered).commit();
                }
                @Override public void restorePersistence() {
                    if (!preferences.edit().putString(DATA, oldData).putStringSet(DELIVERED, oldDelivered).commit()) {
                        throw new IllegalStateException("Could not restore prior reminders");
                    }
                }
            });
        } catch (Exception ignored) { return false; }
    }

    static boolean markDelivered(Context context, String id) {
        if (id == null || id.isEmpty()) return false;
        try {
            Set<String> delivered = new HashSet<>(context.getSharedPreferences(PREFS, 0).getStringSet(DELIVERED, new HashSet<>()));
            delivered.add(id);
            return context.getSharedPreferences(PREFS, 0).edit().putStringSet(DELIVERED, delivered).commit();
        } catch (Exception ignored) { return false; }
    }

    static void restore(Context context) {
        try {
            JSONArray items = new JSONArray(context.getSharedPreferences(PREFS, 0).getString(DATA, "[]"));
            JSONArray rebased = new JSONArray();
            Set<String> delivered = new HashSet<>(context.getSharedPreferences(PREFS, 0).getStringSet(DELIVERED, new HashSet<>()));
            long now = System.currentTimeMillis();
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.optJSONObject(i);
                if (item == null) continue;
                cancel(context, item);
                JSONObject normalized = rebase(item, now);
                if (normalized != null && !delivered.contains(normalized.optString("id", "")) && normalized.optLong("at", 0) > now && normalized.optLong("at", 0) <= now + 8L * 86400000L) {
                    rebased.put(normalized);
                    schedule(context, normalized);
                }
            }
            context.getSharedPreferences(PREFS, 0).edit().putString(DATA, rebased.toString()).apply();
        } catch (Exception ignored) { }
    }

    private static JSONObject rebase(JSONObject item, long now) {
        String localAt = item.optString("localAt", "");
        if (localAt.isEmpty()) return item;
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.ROOT);
        format.setLenient(false);
        ParsePosition position = new ParsePosition(0);
        Date date = format.parse(localAt, position);
        if (date == null || position.getIndex() != localAt.length()) return null;
        try {
            JSONObject result = new JSONObject(item.toString());
            result.put("at", date.getTime());
            return result;
        } catch (Exception ignored) { return null; }
    }

    private static PendingIntent intent(Context context, JSONObject item, int flags) {
        if (item == null) return null;
        String id = item.optString("id", "");
        if (id.isEmpty()) return null;
        Intent intent = new Intent(context, ReminderReceiver.class);
        intent.setData(Uri.parse("timesprout://reminder/" + Uri.encode(id)));
        intent.putExtra("id", id);
        intent.putExtra("title", item.optString("title", "TimeSprout"));
        intent.putExtra("body", item.optString("body", ""));
        return PendingIntent.getBroadcast(context, 0, intent, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void cancel(Context context, JSONObject item) {
        PendingIntent pending = intent(context, item, PendingIntent.FLAG_NO_CREATE);
        if (pending != null) {
            try {
                ((AlarmManager) context.getSystemService(Context.ALARM_SERVICE)).cancel(pending);
            } finally {
                pending.cancel();
            }
        }
    }

    private static void schedule(Context context, JSONObject item) {
        long at = item.optLong("at", 0);
        if (at <= System.currentTimeMillis()) return;
        PendingIntent pending = intent(context, item, PendingIntent.FLAG_UPDATE_CURRENT);
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        try {
            if (Build.VERSION.SDK_INT < 31 || manager.canScheduleExactAlarms()) manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
            else manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
        } catch (SecurityException revoked) {
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
        }
    }
}
