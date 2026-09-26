# TimeSprout

[中文说明](./README.md)

TimeSprout is a lightweight schedule planner. It builds an actionable timeline for the day from your routine, courses, fixed events, and tasks.

Live demo: [dffapi.top](https://dffapi.top)

## Features

- Today's timeline: automatically schedules tasks and supports starting, completing, postponing, and skipping them.
- Calendar view: browse courses, tasks, and one-off events by month, and add tasks for a selected date.
- Priority matrix: organize work by importance and urgency.
- Pomodoro focus: alternate between 25-minute focus sessions and 5-minute breaks while recording actual focus time, including partial sessions.
- Analytics: review 7- or 30-day completion rate, focus time, overdue tasks, current streak, and daily time allocation.
- Appearance: follow the system theme or use light and dark modes.
- Weekly timetable: manage recurring courses and identify time conflicts.
- Break planning: generate date-based study tasks for a range of up to 366 days while reserving daily leisure time.
- Chinese and English interface: switch between 中文 and English at any time.
- Backup and restore: export a `TimeSprout backup v2` `.txt` file and import valid v1 or v2 backups (up to 5 MiB).
- Overdue task management: review overdue tasks together; Delay moves a task to the bedtime deadline of the next planning day.
- In-page reminders: receive reminders 10 minutes before a task, at its start time, and after it becomes overdue.
- Growth-themed interface: consistent colors, cards, forms, and feedback in light and dark modes.
- Responsive navigation: choose top or sidebar navigation on desktop; mobile uses a fixed Today, Calendar, Focus, and More navigation bar.
- Reduced motion: honors the system's reduced-motion preference.

## Quick Start

The browser version has no build step or third-party dependencies. Open [`index.html`](./index.html) directly in a browser.

Alternatively, start a local static server:

```bash
python -m http.server 8000
```

Then visit <http://localhost:8000>.

## Native apps

The Windows and Android apps use this same page, so their Today, Calendar, Priorities, Focus, Analytics, Courses, Breaks, Settings, backup, and language views keep the original layout and behavior. Plans remain local to each installation; use a backup file to move them between devices.

### Windows

On Windows, run `npm ci` and `npm run build:windows`. The installer is written to `dist/`. For development, use `npm run desktop`. Closing the window leaves TimeSprout in the notification area so scheduled reminders can still appear. Use the tray menu to quit. Windows notifications use the system notification sound, subject to the device's notification settings.

### Android

Install JDK 17, Android SDK Platform 35, and Build Tools 35. From `android/`, run `.\gradlew.bat assembleDebug` on Windows or `./gradlew assembleDebug` on macOS/Linux. The debug build uses Gradle's default locally generated debug signing key. The directly installable APK is `android/app/build/outputs/apk/debug/app-debug.apk`. Android 13 and newer asks for notification permission. Android 12 and newer may ask for exact alarm access; without it, the system can delay reminders. Reminders use the default notification sound configured for the TimeSprout channel. The app restores scheduled reminders after a reboot.

Both native apps schedule reminders for the next full 168 hours and refresh them when the plan changes or the app opens. Open the Android app at least once a week to extend its reminder horizon.

## Tests

Tests require a Node.js version that supports `node:test`:

```bash
npm test
```

The suite contains 195 Node.js tests covering scheduling, overnight routines, conflicts, localization, backups, native reminders, focus timing, and primary interactions. It also checks navigation, persistence, backup round trips, legacy-data migration, and Chinese and English navigation. `android/tests/` contains a separate JVM reminder regression test that `npm test` does not run.

## Data and Privacy

- Plans are stored in the current environment's `localStorage` under `student-agenda-single-v1`.
- The app has no account or backend, so data is not automatically synchronized across devices.
- Clearing browser site data or native app data removes local plans. Export a backup from Settings before doing so.
- Imported files are validated first and require two confirmations before replacing the current plan.
- The desktop navigation layout is included in local plans and backups. Older plans default to top navigation to avoid an unexpected layout change after an upgrade.
- The browser page shows in-page reminders while open. The native apps also schedule local system notifications; they do not transmit plan data.

### Analytics and Appearance

The Analytics page provides 7- and 30-day completion rate, focus time, current overdue-task count, completion streak, and daily time allocation. Analytics are stored locally and included in `TimeSprout backup v2` backups.

Time allocation estimates courses, events, and leisure from the current plan. For past dates, task time combines recorded completed-task minutes with the current estimate for pending tasks explicitly assigned to that date. Undated pending tasks are not projected backward. Completed-task minutes use each task's planned duration, not measured time spent.

Task durations use whole minutes. Fractional minutes in older local data are rounded up to retain the task; backup imports with fractional task minutes are rejected.

In Settings, choose System, Light, or Dark appearance. The selected theme is stored with the local plan and its backups.

## Suggested Workflow

1. In Settings, enter your wake-up time, bedtime, and daily leisure time.
2. Add recurring courses in Timetable.
3. Return to Today and add tasks or one-off events. The planner avoids fixed commitments when scheduling work.
4. Use Priorities and Focus to manage the most important task at hand.
5. In Settings, choose top or sidebar navigation on desktop. Mobile always uses the shared bottom navigation, with the remaining features under More.
6. Export backups regularly so you can restore your plan after changing browsers or devices.

## Project Structure

```text
index.html                           # Single-file app: HTML, CSS, and JavaScript
package.json / package-lock.json     # Desktop dependencies, build, and Node.js test commands
planner.test.js                      # Node.js tests and interaction-test harness
audit-*.test.js                      # Bug regression tests
native-reminders-regressions.test.js # Native reminder regression tests
windows/                             # Windows notifications, tray, installer, and reminder-store tests
android/                             # Android notifications, APK project, and standalone JVM tests
LICENSE                              # MIT License
```

Dependency installation and builds generate `node_modules/`, `dist/`, and Android build outputs; these are excluded from version control.

## Current Limitations

- No accounts, cloud sync, or automatic multi-device synchronization.
- Data depends on local storage in the current environment.
- The app is intentionally distributed as a single HTML file for straightforward offline use.

## License

[MIT License](./LICENSE)
