# Noesis Web Clipper

Saves the current web page (or just the selected part) into Noesis on the same computer.
Clips land under a **Web clips** page, with a link back to the source.

## Install (Chrome, Edge, Brave)
1. Download `noesis-web-clipper.zip` from the latest release and unzip it (or use this folder).
2. Open `chrome://extensions` (Edge: `edge://extensions`), turn on **Developer mode**.
3. **Load unpacked** → choose the unzipped folder.

## Install (Firefox)
`about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick `manifest.json`
(temporary add-ons are removed when Firefox restarts; a signed build needs Mozilla review).

## Connect
1. In Noesis: **Settings → AI connections**, switch the connection on.
2. Copy the **web clipper key** shown there and paste it into the extension popup once.
3. Click the extension icon (or press **Alt+Shift+S**) on any page → **Save page**.

## Privacy
The extension talks only to `http://127.0.0.1` (your own computer). Nothing is sent anywhere else.
Images in clipped pages stay links to the original site and are loaded from there when displayed.
