# TimeSprout

[中文说明](./README.md)

TimeSprout is a lightweight schedule planner. It builds an actionable timeline for the day from your routine, courses, fixed events, and tasks.

Live demo: [dffapi.top](https://dffapi.top)

## Features

- Today's timeline: automatically schedules tasks and supports starting, completing, postponing, and skipping them.
- Calendar view: browse courses, tasks, and one-off events by month, and add tasks for a selected date.
- Priority matrix: organize work by importance and urgency.
- Pomodoro focus: alternate between 25-minute focus sessions and 5-minute breaks while recording total focus time.
- Analytics: review 7- or 30-day completion rate, focus time, overdue tasks, current streak, and daily time allocation.
- Appearance: follow the system theme or use light and dark modes.
- Weekly timetable: manage recurring courses and identify time conflicts.
- Break planning: generate date-based study tasks while reserving daily leisure time.
- Chinese and English interface: switch between 中文 and English at any time.
- Backup and restore: export a `TimeSprout backup v2` `.txt` file and import valid v1 or v2 backups.
- Overdue task management: review overdue tasks together and reschedule them.
- In-page reminders: receive reminders 10 minutes before a task, at its start time, and after it becomes overdue.
- Responsive navigation: choose top or sidebar navigation on desktop; mobile uses a fixed Today, Calendar, Focus, and More navigation bar.
- Reduced motion: honors the system's reduced-motion preference.

## Quick Start

The project has no build step or third-party dependencies. Open [`index.html`](./index.html) directly in a browser.

Alternatively, start a local static server:

```bash
python -m http.server 8000
```

Then visit <http://localhost:8000>.

## Tests

Tests require a Node.js version that supports `node:test`:

```bash
node --check planner.test.js
node --test planner.test.js
```

The test suite contains 109 tests. It covers scheduling, overnight routines, conflict detection, localization, backups, reminders, and primary interactions. It also validates navigation-layout normalization and persistence, backup round trips, legacy-data migration, and the accessibility of Chinese and English navigation.

## Data and Privacy

- Plans are stored in the current browser's `localStorage` under `student-agenda-single-v1`.
- The app has no account or backend, so data is not automatically synchronized across devices.
- Clearing site data removes local plans. Export a backup from Settings before doing so.
- Imported files are validated first and require two confirmations before replacing the current plan.
- The desktop navigation layout is included in local plans and backups. Older plans default to top navigation to avoid an unexpected layout change after an upgrade.
- Reminders are shown only while the page is open; they do not create system notifications or transmit data.

### Analytics and Appearance

The Analytics page provides 7- and 30-day completion rate, focus time, current overdue-task count, completion streak, and daily time allocation. Analytics are stored locally and included in `TimeSprout backup v2` backups.

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
index.html       # Single-file app: HTML, CSS, and JavaScript
planner.test.js  # Node.js tests and interaction-test harness
LICENSE          # MIT License
```

## Current Limitations

- No accounts, cloud sync, multi-device synchronization, or native mobile notifications.
- Data depends on browser-local storage.
- The app is intentionally distributed as a single HTML file for straightforward offline use.

## License

[MIT License](./LICENSE)
