# FluxFetch Privacy Policy

_Last updated: October 28, 2026_

FluxFetch is a Windows app for downloads, torrents, browser handoff, media downloads, and network tools. This policy covers the desktop app, its Chrome, Edge, and Firefox integrations, and the optional OmniLink and Net Merge features.

## The short version

FluxFetch does not have a user account, cloud sync, advertising, or a FluxFetch analytics service. Download history, settings, and other app data stay in your Windows user profile. Some features connect to the website, tracker, peer, or service needed to do what you asked. Those services will see the network information that normally comes with a connection, such as your IP address.

## What FluxFetch saves on your PC

To run the app, FluxFetch keeps settings, download queues, recovery information, and a download history. History can include the URL and source page, file name and save location, status, timestamps, size, and transfer speeds. These details help the app resume work and show you what happened. They are stored locally in the app's data folder; FluxFetch does not upload them to a FluxFetch server. The history and settings are not all encrypted, so anyone with access to your Windows account may be able to read some of them.

If you save a website cookie or sign-in token, proxy credentials, or remote-access credentials, FluxFetch protects saved secrets with Windows-backed encryption. Website cookies and authorization details are used only for downloads from the matching website origin. Proxy credentials are sent to the proxy you configured. Remote-access passwords are stored as a salted hash rather than as readable text.

Downloaded files are saved in the folder you choose. Removing a record from FluxFetch history does not delete the downloaded file.

## Browser extensions

When browser capture is enabled, the extension checks web requests to recognize a download you chose to start. It may temporarily handle the request URL, page URL, file name, and selected request headers. Depending on the site and request, headers can include cookies, authorization, referrer, origin, or user-agent information.

The extension passes the details needed for a download to FluxFetch through the browser's Native Messaging connection on the same PC. It does not send them to a FluxFetch cloud service. The original website receives the request FluxFetch makes to download the file. The extension keeps settings in the browser and uses temporary session storage for recent requests; temporary records expire or are cleared when the browser session ends.

For a YouTube download, the extension can offer an optional sign-in-cookie retry if the ordinary request fails. If you choose that retry, it passes YouTube cookies and the browser's user-agent to the local FluxFetch app for that request. FluxFetch uses them with the YouTube download and removes its temporary cookie file when the request ends. You can decline this option.

## Connections made by app features

- **Downloads and media:** FluxFetch connects to the URL you provide or select. The site hosting the file or media receives the request and may receive cookies or authorization headers needed for that request. Video tools such as yt-dlp, Deno, or FFmpeg may be downloaded from their upstream GitHub releases when a video feature needs them. FluxFetch checks downloaded tools against pinned hashes.
- **Torrents:** Torrent downloads contact the trackers and peers listed by the torrent or discovered through peer discovery. Those services and other peers can see your network address and torrent activity, as is normal for peer-to-peer transfers.
- **Update checks:** The app checks GitHub for the latest FluxFetch release at startup, when the app regains focus, and periodically while it is open. GitHub receives the ordinary request information needed to serve that check. The request does not include your download history.
- **Speed tests:** When you run a speed test, FluxFetch sends or receives a test sample through Cloudflare's speed-test service. The upload is generated test data, not one of your files. Cloudflare can see the connection and test request.
- **Net Merge:** While its engine is running, Net Merge periodically asks Cloudflare's trace endpoint for the public IP address seen on an active network adapter. This helps show adapter status. Cloudflare receives that request and can see that public IP address.
- **Remote access:** This feature is off until you enable it and save credentials. When enabled, FluxFetch runs an HTTPS server on your PC so another device that can reach it on your network can manage downloads. There is no FluxFetch relay or cloud account. Only enable it on networks you trust, and do not expose its port to the public internet unless you understand the risks. The local certificate is generated on your PC; a browser may warn that it is not issued by a public certificate authority.

The websites and services above have their own privacy policies and may retain connection data under their own rules. FluxFetch does not control that retention.

## Your choices and deleting data

You can turn off browser capture, remove either browser extension, disable Net Merge or OmniLink, and leave remote access off. You can remove download records in the app and remove saved website authentication or proxy settings in Settings. You can also use FluxFetch's fresh-install option to clear the app's settings and history while keeping downloaded files. Browser extension settings and temporary browser data are managed by the browser.

## Contact

For a privacy question, open an issue in the [FluxFetch GitHub repository](https://github.com/SheedaMusalli/FluxFetch-Download-Manager/issues). GitHub issues may be public, so please do not include passwords, cookies, download links that contain private tokens, or other sensitive information.
