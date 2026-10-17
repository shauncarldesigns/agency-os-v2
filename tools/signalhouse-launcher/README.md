# Signalhouse Mac launcher

This per-user macOS app handles `signalhouse://open`. It starts the existing local Signalhouse Next.js server if necessary, waits for the Signal House homepage to respond, then opens `http://127.0.0.1:3000` in the default browser. Double-clicking the launcher does the same thing.

The URL accepts no arbitrary commands, arguments, or project paths. The server binds only to `127.0.0.1`. A launchd job owns it so it survives the launcher exiting; repeated opens reuse it. The job does not run automatically at login and does not automatically restart a stopped server. No account, hosting, or paid service is added.

## Install

Requires macOS, Apple's command-line developer tools, Node 22+, and Signalhouse with its dependencies installed. Run from this repository:

```sh
python3 tools/signalhouse-launcher/install.py \
  --project /absolute/path/to/signal-house \
  --node /absolute/path/to/node
```

The installer compiles and locally signs the application before installation. It refuses to overwrite existing app or agent files.

Installed files:

- `~/Applications/Signalhouse Launcher.app`
- `~/Library/LaunchAgents/com.shauncarldesigns.signalhouse.server.plist`
- `~/Library/Logs/Signalhouse/server.log`

The browser may ask permission to open Signalhouse Launcher the first time. Approve that normal application-open prompt. Each Mac needs its own installation. The hub also offers an ordinary browser link for an already-running server.

## Stop or remove

Stop the local server without deleting project data:

```sh
launchctl kill SIGTERM gui/$(id -u)/com.shauncarldesigns.signalhouse.server
```

The next launcher invocation starts it again. To uninstall, first unload its job:

```sh
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.shauncarldesigns.signalhouse.server.plist
```

Then move the installed app and plist to Trash. Keep the Signalhouse project. Logs can be removed separately if no longer needed.

## Troubleshooting

If startup fails, the launcher displays an error and the server log contains details. An unrelated application occupying port 3000 is never killed or opened as Signalhouse. Move that application off port 3000 and retry. If the Signalhouse checkout or Node installation moves, update the launch agent's fixed paths or reinstall the launcher after uninstalling it.
