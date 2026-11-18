# Kiosk

`/kiosk` is the twin for a portrait screen in a public room: the 85-inch panel of the
OpenTwin sprint (WP3), 1080 × 1920 and up. It shows the synthetic demo body standing
full length and turning slowly, the title above it and the research line below.

It reads no person's data. The body is the ANNY demo mesh ([anatomy.md](anatomy.md)),
never a scan, so the page needs no sign-in, no unlock and no sidebar. It is always
dark, whatever the machine's theme. On a landscape screen the same portrait column
stands in the centre.

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
