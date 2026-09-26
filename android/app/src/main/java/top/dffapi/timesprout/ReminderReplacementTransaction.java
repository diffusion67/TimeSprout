package top.dffapi.timesprout;

import java.util.ArrayList;
import java.util.List;

/** Coordinates alarm replacement and best-effort rollback if any step fails. */
final class ReminderReplacementTransaction {
    interface Adapter<T> {
        void cancel(T item) throws Exception;
        void schedule(T item) throws Exception;
        boolean persist() throws Exception;
        void restorePersistence() throws Exception;
    }

    private ReminderReplacementTransaction() {}

    static <T> boolean replace(List<T> oldItems, List<T> newItems, Adapter<T> adapter) {
        List<T> attempted = new ArrayList<>();
        try {
            for (T oldItem : oldItems) adapter.cancel(oldItem);
            for (T newItem : newItems) {
                // Include the current item before scheduling: the platform call may partially succeed
                // before throwing, and its PendingIntent still needs to be cancelled on rollback.
                attempted.add(newItem);
                adapter.schedule(newItem);
            }
            if (!adapter.persist()) throw new IllegalStateException("Could not persist replacement reminders");
            return true;
        } catch (Exception failure) {
            for (int i = attempted.size() - 1; i >= 0; i--) {
                try { adapter.cancel(attempted.get(i)); } catch (Exception ignored) { }
            }
            for (T oldItem : oldItems) {
                try { adapter.schedule(oldItem); } catch (Exception ignored) { }
            }
            try { adapter.restorePersistence(); } catch (Exception ignored) { }
            return false;
        }
    }
}
