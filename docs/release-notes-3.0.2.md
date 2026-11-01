# FluxFetch 3.0.2

This release makes the Downloads Library easier to revisit and manage, and cleans up repeated links in batch queues.

## What's changed

- The library remembers your selected status filter and sort order after closing or restarting FluxFetch.
- A result count shows how many downloads match the current search and filters.
- Empty searches explain that nothing matched and provide a one-click way to clear the search and filters.
- Ctrl+A selects the visible removable downloads when focus is outside an editor or dialog.
- Bulk actions can copy the selected file names, source URLs, or destination paths.
- A clear-selection action makes it easy to exit bulk mode.
- Export the currently visible library rows as a CSV file.
- Batch queue previews remove repeated links and links that are already waiting, while showing how many were skipped.
- On Windows, FluxFetch can start when you sign in and remain in the system tray until you open its window.
- First-time installs skip the update-versus-fresh-install choice; it appears only when FluxFetch is already installed.

These changes affect FluxFetch for Windows. The browser extension packages are unchanged; Firefox users can install the approved add-on through [Mozilla Add-ons](https://addons.mozilla.org/en-US/firefox/addon/fluxfetch-integration-module/).

## Windows installer

Download `fluxfetch-3.0.2-setup.exe` from the release assets. The installer is for Windows 10 and 11 on x64 systems. It is not Authenticode-signed.
