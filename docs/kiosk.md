# Kiosk

`/kiosk` is the twin for a portrait screen in a public room: the 85-inch panel of the
OpenTwin sprint (WP3), 1080 × 1920 and up. It shows the synthetic demo body standing
full length and turning slowly, the title above it and the research line below.

It reads no person's data. The body is the ANNY demo mesh ([anatomy.md](anatomy.md)),
never a scan, so the page needs no sign-in, no unlock and no sidebar. It is always
dark, whatever the machine's theme. On a landscape screen the same portrait column
stands in the centre.

## The day

Under the twin the kiosk plays the illustrative mock day
(`packages/query-tools/fixtures/mock-day.json`) in the kiosk-day shape
([kiosk-day.md](kiosk-day.md)), built on the server by `mockKioskDay` and drawn as
written: the time and event, the value line, the body sentence, and where the twin
turns. The twin goes to the beat's layer and lights its organ. A window's beat reads
"Worth a look" with a mark and a note beside it, never a colour alone. The notice, the
placeholder note and "Times are UTC" stay on screen with every beat.

Above the beat a strip runs from midnight to midnight with a tick per beat time: the
current one tall and solid, a worth-a-look time as a ring over a hatched band
(`kiosk-strip.ts`). Shapes, not colours, tell them apart. The strip only places the
times the day already wrote, and screen readers skip it because the beat says the same
in words.

## A visit

With nobody at the screen the kiosk runs its attract loop: the twin turns and the screen
asks for a press. Meanwhile the twin lights the places the day will visit, one every
eight seconds, in the day's order (for the mock day: heart, blood vessels, pancreas,
liver; `kiosk-tour.ts`), so a passer-by sees what the day is about.

A press starts the day on its first beat; each press after that goes on a beat, and the
left arrow goes back one. A press on the last beat ends the day, and so does a minute
with no press (`IDLE_RESET_MS` in `features/digital-twin/kiosk/kiosk-session.ts`).
Either way the kiosk is back in the attract loop exactly as it started, the tour on its
first place again.

Nothing of a visit is kept. The session lives in memory only, no kiosk file touches
browser storage or cookies (a test reads them to check), and focus is let go on the way
back to the attract loop.

## Triggers

A trigger is what presses: a function that calls `onPress` (or `onBack`) and returns a
function that stops listening (`kiosk-trigger.ts`). The screen itself is one, a press
anywhere on it. The keyboard is another: Space, Enter and the right or down arrow press,
the left or up arrow go back, so a desk test or a USB button that sends a key works. The
light ring on the kiosk's stand will be a third with the same shape, once how it talks to
the browser is decided.

## Running it on the screen

The demo body has to be on the machine first (`bun run anatomy:fetch`, see
[anatomy.md](anatomy.md)). Then start the app and open the page full screen:

```sh
bun run build && bun run start
chromium --kiosk --noerrdialogs --disable-session-crashed-bubble \
  --incognito http://127.0.0.1:3000/kiosk
```

`--incognito` keeps nothing between browser starts. Without WebGL the page says so
instead of showing the twin; a lost WebGL context (a driver reset on a screen that runs
all day) redraws the view.
