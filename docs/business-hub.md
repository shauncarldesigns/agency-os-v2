# Agency OS business hub

Agency OS opens at the business hub. Its three workspaces are:

- **Signalhouse:** opens the installed Mac launcher through `signalhouse://open`. The launcher starts the local server when needed and opens `http://127.0.0.1:3000`. A separate browser link supports an already-running server. See `tools/signalhouse-launcher/README.md` for installation and removal.
- **Lead Engine:** the existing agency dashboard, including lead generation and website building.
- **AI Dropshipping:** disabled Coming soon card until the application exists.

Card copy and destinations live in `agency-os-dashboard/src/components/hub/BusinessHub.tsx`.

## Navigation

- `/` or `/#/`: business hub.
- `/#/lead-engine/dashboard`: Lead Engine dashboard.
- `/#/lead-engine/<tab>`: any supported agency tab, including `docs`, `sites`, and `prospect`.

Hash routes work with existing static hosting without rewrite changes. Internal navigation updates the address and supports browser Back/Forward and refresh. Unknown Lead Engine tab names fall back to its dashboard; unrelated hashes show the hub.

The Lead Engine sidebar includes an Agency OS hub link, also available in its mobile drawer. Agency API loading begins when Lead Engine is opened. Existing hosting access controls continue to apply.

This change adds no backend endpoints, database migrations, shared authentication, or hosted Signalhouse service.
