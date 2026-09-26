package top.dffapi.timesprout;

/** Full reminder IDs are used as notification tags so hash collisions cannot merge notices. */
final class ReminderIdentity {
    private ReminderIdentity() {}

    static String notificationTag(String reminderId) {
        return reminderId;
    }
}
