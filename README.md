# Fidelity.Stay ExtraNet

A static, browser-only partner portal prototype for Fidelity Stay.

## Run locally

Open `index.html` in a modern browser. There is no build step or package install.

## Account and data modes

The site supports a browser-only demo mode and an optional Firebase cloud mode. It uses demo mode until the Firebase web configuration is added to `firebase-config.js`. In demo mode, accounts and property listings exist only in the current browser; do not enter a real or reused password.

### Enable Firebase cloud mode (free tier)

1. Create a Firebase project on the [Spark no-cost plan](https://firebase.google.com/pricing) and add a Web app.
2. In Firebase Authentication, enable **Email/Password**.
3. Create a Cloud Firestore database.
4. Copy the Web app's `apiKey`, `authDomain`, `projectId`, and `appId` into `firebase-config.js`. These web app identifiers are public client configuration, not service-account credentials. Never put a Firebase Admin/service-account key in this site.
5. In Firebase Authentication settings, add the deployed GitHub Pages hostname (and `localhost` if testing on a local web server) to **Authorized domains**.
6. Publish the contents of `firestore.rules` in the Firestore **Rules** tab and publish the site. The Pages workflow includes `firebase-config.js`.

The rules restrict each signed-in user to their own profile and property data. Firebase handles passwords and password-reset emails; profiles, listings, and listing photos are stored in Firestore and can be loaded on another device. Selecting **Remember me on this device** creates the cloud account; leaving it unchecked does not create or save an account. Deleting a cloud account asks for its password and removes its saved Firestore data.

Firebase Spark currently includes no-cost quotas (including 50,000 monthly active Authentication users and Firestore usage/storage limits); service quotas and plan terms can change. This setup uses email/password authentication and Firestore, not paid phone/SMS authentication. If Firebase is not configured, the site clearly remains in browser-only demo mode.

Property setup includes property details, amenities, rooms/rates/dates, and photos. Booking, live payment, and guest messaging services are not connected. Do not use real guest or payment information in this prototype.

## Publish with GitHub Pages

The GitHub Actions workflow deploys the static site when changes are pushed to `main`. Enable GitHub Pages for the repository and select **GitHub Actions** as the build and deployment source.

The workflow stages `index.html`, `styles.css`, `script.js`, `firebase-config.js`, and `fidelity-stay-logo.png` for publication. `firestore.rules` must be published to your Firebase project separately.
