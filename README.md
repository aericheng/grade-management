# grade-management

A Chrome extension side panel that reads your own NYCU registration-system grade pages and turns them into a live GPA calculator and graduation-credit tracker — no data leaves your browser.

## What it does

- **Grade dashboard** — fetches your semester grade lists and per-semester detail pages from `regist.nycu.edu.tw` (using your existing logged-in session) and renders them by semester in the side panel.
- **GPA calculation (4.3 scale)** — computes overall and per-semester GPA from letter grades, correctly excluding withdrawn/pass-fail/offset-credit courses.
- **Grade prediction** — lets you set a min/max expected letter grade for still-ungraded courses and shows a projected min/average/max GPA that updates live.
- **Graduation-credit tracking** — a second tab lets you import your required-course and elective-course lists (CSV: `course name,credits`), then automatically classifies completed courses (required / core elective / other elective / core-curriculum basic / core-curriculum domain / English / second foreign language) and shows credits earned vs. remaining per category, with manual category overrides for edge cases.
- **Debug log** — an in-panel log modal (with copy-to-clipboard) for troubleshooting page-parsing issues when the university site's HTML changes.

All state (predictions, imported course lists, category overrides, semester cache) is kept in the browser's `localStorage`; nothing is sent to any third-party server.

## Project structure

```
manifest.json      Manifest V3 config: side panel entry, host permission for regist.nycu.edu.tw
background.js       service worker: opens the side panel on the toolbar icon click
sidepanel.html       side panel UI (Grades tab + Graduation Credits tab)
sidepanel.js          all logic: page scraping/parsing, GPA math, graduation-credit stats, localStorage persistence
styles.css            side panel styling
128.png                extension icon
```

## How to run

This is an unpacked Manifest V3 Chrome extension with no build step.

1. Open `chrome://extensions`.
2. Enable "Developer mode" (top right).
3. Click "Load unpacked" and select this repository's folder.
4. Log in to `https://regist.nycu.edu.tw` in the same browser, then click the extension's toolbar icon to open the side panel and fetch your grades.

## License

MIT — see `LICENSE`.
