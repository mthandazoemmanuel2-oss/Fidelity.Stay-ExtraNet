# Fidelity.Stay ExtraNet

A static, browser-only partner portal prototype for Fidelity Stay.

## Run locally

Open `index.html` in a modern browser. There is no build step or package install.

## Prototype limitations

- Accounts and property listings are stored only in the current browser. Account creation saves details only when **Remember me on this device** is selected.
- Property setup includes a grouped amenities checklist and optional custom amenities. Sign-out preserves the local account; account deletion removes it and its properties from this browser only.
- Sign-in is a demonstration flow, not production authentication. Do not enter a real or reused password.
- There is no server, Google sign-in, Firebase integration, guest booking, or live payment processing.
- Public hosting makes this demo accessible to anyone. Do not store sensitive or real guest information in it.

## Publish with GitHub Pages

The GitHub Actions workflow deploys the static site when changes are pushed to `main`. Enable GitHub Pages for the repository and select **GitHub Actions** as the build and deployment source.

The workflow stages only `index.html`, `styles.css`, `script.js`, and `fidelity-stay-logo.png` for publication.
