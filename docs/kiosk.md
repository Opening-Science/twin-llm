# Kiosk

`/kiosk` is the twin for a portrait screen in a public room: the 85-inch panel of the
OpenTwin sprint (WP3), 1080 × 1920 and up. It shows the synthetic demo body standing
full length and turning slowly, the title above it and the research line below.

It reads no person's data. The body is the ANNY demo mesh ([anatomy.md](anatomy.md)),
never a scan, so the page needs no sign-in, no unlock and no sidebar. It is always
dark, whatever the machine's theme. On a landscape screen the same portrait column
stands in the centre. Type and spacing follow the screen's height, so a 4K panel
(2160 × 3840) at a scale of one reads like a 1080 × 1920 one, only sharper.

## The day

Under the twin the kiosk plays the illustrative mock day
(`packages/query-tools/fixtures/mock-day.json`) in the kiosk-day shape
([kiosk-day.md](kiosk-day.md)), built on the server by `mockKioskDay` and drawn as
written: the time and event, the value line, the body sentence, and where the twin
turns. The twin goes to the beat's layer and lights its organ, through the same
`beatFocus` as the twin page's day panel. A window's beat reads "Worth a look" with the
day panel's eye and a note beside it, never a colour alone. The notice, the placeholder
note and "Times are UTC" stay on screen with every beat.

## A visit

With nobody at the screen the kiosk runs its attract loop: the twin turns and the screen
asks for a press. Meanwhile the twin lights the places the day will visit, one every
eight seconds, in the day's order (for the mock day: heart, blood vessels, pancreas,
liver; `kiosk-tour.ts`), so a passer-by sees what the day is about.

A press starts the day on its first beat; each press after that goes on a beat, and the
left arrow goes back one. A press on the last beat ends the day, and so does a minute
with no press (`IDLE_RESET_MS` in `features/digital-twin/kiosk/kiosk-session.ts`).
Either way the kiosk is back in the attract loop exactly as it started. A line above the
beat says what a press does ("Press anywhere for the next moment", and on the last beat
"Press to finish"); in the last ten seconds before the reset it counts down instead, in
a box, so nobody is surprised when the day goes away (`kiosk-hint.ts`).

Nothing of a visit is kept. The session lives in memory only, no kiosk file touches
browser storage or cookies (a test reads them to check), and focus is let go on the way
back to the attract loop.

## Triggers

A trigger is what presses: a function that sends an input (`press`, `back` or `reset`)
and returns a function that stops listening (`kiosk-trigger.ts`). The screen itself is
one, a press anywhere on it. The keyboard is another: Space, Enter and the right or down
arrow press, the left or up arrow go back, and Escape sends the kiosk straight back to
the attract loop, so a desk test, a USB button that sends a key, or staff at the screen
all work. The light ring on the kiosk's stand will be a third with the same shape, once
how it talks to the browser is decided.

## Running it on the screen

The demo body has to be on the machine first (`bun run anatomy:fetch`, see
[anatomy.md](anatomy.md)). Then start the app and open the page full screen:

```sh
bun run build && bun run start
chromium --kiosk --noerrdialogs --disable-session-crashed-bubble \
  --incognito --disable-pinch --overscroll-history-navigation=0 \
  http://127.0.0.1:3000/kiosk
```

`--incognito` keeps nothing between browser starts. `--disable-pinch` and
`--overscroll-history-navigation=0` stop a visitor zooming the screen or swiping back
to an empty page; the page itself keeps a tap a press at once, with no long-press menu
and no grey tap flash. Without WebGL the page says so instead of showing the twin; a
lost WebGL context (a driver reset on a screen that runs all day) redraws the view.

The page needs no sign-in, so on a hosted deployment anyone with the address can open
it. It shows only the synthetic body and the mock day, and asks search engines to leave
it out (`kiosk-meta.ts`).
