const navigation = [...document.querySelectorAll(".nav-item[data-page]")];
const pageRoot = document.getElementById("page-root");
const toast = document.getElementById("toast");
const authShell = document.getElementById("auth-shell");
const authRoot = document.getElementById("auth-root");
const appShell = document.querySelector(".app-shell");
const accountStorageKey = "fidelity-stay.partner-accounts.v1";

const bookings = [];
const guests = [];
let properties = [];
let activePage = "overview";
let calendarWeekOffset = 0;
let currentAccount = null;
let selectedPropertyId = "";
let propertySetupStep = 1;
let propertyDraft;
let propertyDraftPhotos = [];

const blankPropertyDraft = () => ({
  name: "",
  type: "",
  country: "",
  city: "",
  address: "",
  description: "",
  checkIn: "14:00",
  checkOut: "11:00",
  roomName: "",
  roomCount: "1",
  guestsPerRoom: "2",
  baseRate: "",
  currency: "ZAR",
  availableFrom: "",
  availableUntil: "",
  minimumStay: "1",
});
propertyDraft = blankPropertyDraft();

function loadAccounts() {
  let saved;
  try {
    saved = localStorage.getItem(accountStorageKey);
  } catch {
    throw new Error("This browser does not allow local account storage. Open the site in a regular browser window and try again.");
  }
  if (!saved) return [];

  try {
    const accounts = JSON.parse(saved);
    if (!Array.isArray(accounts)) throw new Error("Invalid account data");
    return accounts;
  } catch {
    throw new Error("Saved account data could not be read. Clear this site's browser storage or contact support.");
  }
}

function saveAccounts(accounts) {
  try {
    localStorage.setItem(accountStorageKey, JSON.stringify(accounts));
  } catch {
    throw new Error("Your account could not be saved in this browser. Check available storage and try again.");
  }
}

function saveCurrentAccount() {
  if (!currentAccount) throw new Error("Sign in again before saving this property.");
  const accounts = loadAccounts();
  const accountIndex = accounts.findIndex((account) => account.email === currentAccount.email);
  if (accountIndex < 0) throw new Error("Your account is no longer available in this browser. Sign in again.");
  accounts[accountIndex] = currentAccount;
  saveAccounts(accounts);
}

function syncProperties() {
  properties = Array.isArray(currentAccount?.properties)
    ? currentAccount.properties.map((property) => [
      property.name,
      `${property.city}, ${property.country}`,
      `${property.roomCount} rooms`,
      "0%",
      "Setup complete",
      property,
    ])
    : [];
}

function updatePropertySwitcher() {
  const select = document.querySelector(".property-select");
  const name = document.querySelector(".switcher-name");
  if (!select || !name) return;
  select.replaceChildren();

  if (!properties.length) {
    const option = new Option("No properties yet", "");
    option.disabled = true;
    option.selected = true;
    select.add(option);
    selectedPropertyId = "";
    name.textContent = "No properties yet";
    return;
  }

  if (!properties.some((property) => property[5].id === selectedPropertyId)) {
    selectedPropertyId = properties[0][5].id;
  }
  properties.forEach((property) => {
    const option = new Option(property[0], property[5].id);
    option.selected = property[5].id === selectedPropertyId;
    select.add(option);
  });
  name.textContent = properties.find((property) => property[5].id === selectedPropertyId)?.[0] || properties[0][0];
}

function getSelectedProperty() {
  return properties.find((property) => property[5].id === selectedPropertyId)?.[5] || properties[0]?.[5] || null;
}

function propertyEmptyState(title, text, action = "Start with your first property") {
  const actionAttribute = action === "Manage properties"
    ? 'data-page="properties"'
    : action === "View reservations"
      ? 'data-page="reservations"'
      : action === "Review availability"
        ? 'data-page="calendar"'
        : 'data-action="start-property"';
  return `<div class="empty-state"><div class="empty-state-icon">⌂</div><h3>${title}</h3><p>${text}</p><button class="primary-btn" type="button" ${actionAttribute}>${action}</button></div>`;
}

function compressPhoto(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error(`${file.name} is not an image.`));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      reject(new Error(`${file.name} is larger than 8 MB. Choose a smaller image.`));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error(`Could not open ${file.name}.`));
      image.onload = () => {
        const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Your browser could not prepare this photo."));
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve({ name: file.name, data: canvas.toDataURL("image/jpeg", 0.76) });
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function capturePropertyDraft(form) {
  const formData = new FormData(form);
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") propertyDraft[key] = value.trim();
  }
}

function createSalt() {
  if (!crypto?.getRandomValues || !crypto?.subtle) {
    throw new Error("Secure password storage is unavailable in this browser. Open the site over HTTPS or localhost.");
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password, salt) {
  if (!crypto?.subtle) {
    throw new Error("Secure password storage is unavailable in this browser. Open the site over HTTPS or localhost.");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: Uint8Array.from(salt.match(/.{2}/g), (byte) => parseInt(byte, 16)), iterations: 210000 },
    key,
    256,
  );
  return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function showAuthError(form, message) {
  form.querySelector(".auth-error")?.remove();
  const error = document.createElement("p");
  error.className = "auth-error";
  error.setAttribute("role", "alert");
  error.textContent = message;
  form.prepend(error);
}

const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[character]));

function renderAuth(view = "signin", email = "") {
  const safeEmail = escapeHTML(email);
  const views = {
    signin: `
      <div class="auth-layout">
        <section class="auth-pitch">
          <div class="pitch-copy">
            <p class="auth-kicker">FIDELITY STAY PARTNER HUB</p>
            <h1>Make every stay<br>count.</h1>
            <p>One place to manage your property, welcome your guests and grow your business.</p>
          </div>
          <div class="pitch-preview" aria-label="Fidelity Stay partner tools preview">
            <div class="preview-top"><span class="preview-dot"></span><span>Partner overview</span><span class="preview-date">TODAY</span></div>
            <div class="preview-metrics"><span><small>Occupancy</small><strong>0%</strong></span><span><small>Guest stays</small><strong>0 bookings</strong></span></div>
            <div class="preview-bars"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
            <div class="preview-booking"><span class="preview-guest">FS</span><span><strong>Your first property</strong><small>Add rooms, rates and open stay dates</small></span><b>Get started</b></div>
          </div>
          <div class="pitch-benefits"><span><i>✓</i> One dashboard for your properties</span><span><i>✓</i> Helpful insights, all in one place</span><span><i>✓</i> Support when you need it</span></div>
        </section>
        <section class="auth-card-wrap">
          <div class="auth-card">
            <p class="auth-eyebrow">WELCOME BACK</p>
            <h2>Sign in</h2>
            <p class="auth-description">Use your Fidelity Stay partner account to continue.</p>
            <form class="auth-form" data-auth-form="signin">
              <label>Email address<input name="email" type="email" placeholder="name@company.com" autocomplete="email" value="${safeEmail}" required></label>
              <label>Password<span class="password-field"><input id="signin-password" name="password" type="password" placeholder="Enter your password" autocomplete="current-password" required><button type="button" class="password-toggle" data-toggle-password="signin-password" aria-label="Show password">Show</button></span></label>
              <div class="auth-options"><label class="remember-option"><input type="checkbox" name="remember"> <span>Remember me</span></label><button class="auth-link" type="button" data-auth-view="forgot">Forgot password?</button></div>
              <button class="auth-submit" type="submit">Sign in</button>
            </form>
            <div class="auth-divider"><span>PARTNER ACCESS PREVIEW</span></div>
            <p class="auth-switch">New to Fidelity Stay? <button type="button" data-auth-view="signup">Create a partner account</button></p>
            <p class="auth-note"><span>▣</span> Prototype accounts are saved in this browser only. Don’t reuse a real password.</p>
          </div>
        </section>
      </div>`,
    signup: `
      <div class="auth-layout">
        <section class="auth-pitch signup-pitch">
          <div class="pitch-copy"><p class="auth-kicker">GROW WITH FIDELITY STAY</p><h1>Your next<br>chapter starts here.</h1><p>Bring your property to a thoughtful community of travellers and manage your hospitality business with confidence.</p></div>
          <div class="signup-steps"><span><b>01</b><strong>Create your account</strong><small>Set up your partner profile</small></span><span><b>02</b><strong>Add your property</strong><small>Tell us about your place</small></span><span><b>03</b><strong>Welcome your guests</strong><small>Get ready for your first stay</small></span></div>
          <div class="pitch-security"><span>✓</span> Free to register · You stay in control</div>
        </section>
        <section class="auth-card-wrap">
          <div class="auth-card signup-card">
            <p class="auth-eyebrow">PARTNER REGISTRATION</p>
            <h2>Create your account</h2>
            <p class="auth-description">Start with your details. You can add your property next.</p>
            <form class="auth-form" data-auth-form="signup">
              <label>Full name<input name="name" type="text" placeholder="Your first and last name" autocomplete="name" required></label>
              <label>Work email<input name="email" type="email" placeholder="name@company.com" autocomplete="email" value="${safeEmail}" required></label>
              <label>Create password<span class="password-field"><input id="signup-password" name="password" type="password" placeholder="At least 8 characters" autocomplete="new-password" minlength="8" required><button type="button" class="password-toggle" data-toggle-password="signup-password" aria-label="Show password">Show</button></span><small class="field-help">Use at least 8 characters.</small></label>
              <label>Confirm password<input name="confirm-password" type="password" placeholder="Enter your password again" autocomplete="new-password" minlength="8" required></label>
              <label class="terms-option"><input type="checkbox" name="terms" required><span>I agree to the <a href="#terms">Partner Terms</a> and <a href="#privacy">Privacy Policy</a>.</span></label>
              <button class="auth-submit" type="submit">Create account</button>
            </form>
            <p class="auth-switch">Already have an account? <button type="button" data-auth-view="signin">Sign in</button></p>
            <p class="auth-note"><span>▣</span> This prototype saves your account in this browser only. Don’t use a password you use elsewhere.</p>
          </div>
        </section>
      </div>`,
    verify: `
      <section class="auth-single-card">
        <div class="verify-icon" aria-hidden="true">✉</div>
        <p class="auth-eyebrow">ONE LAST STEP</p>
        <h1>Check your inbox</h1>
        <p>Your partner account for <strong>${safeEmail}</strong> has been saved in this browser.</p>
        <div class="demo-info"><strong>Email confirmation isn’t connected</strong><span>Sign in with the email and password you just created. Account data stays in this browser.</span></div>
        <button class="auth-submit" type="button" data-auth-view="signin" data-auth-email="${safeEmail}">Continue to sign in</button>
        <button class="auth-back-link" type="button" data-auth-view="signin" data-auth-email="${safeEmail}">Back to sign in</button>
      </section>`,
    forgot: `
      <section class="auth-single-card">
        <div class="verify-icon reset-icon" aria-hidden="true">↗</div>
        <p class="auth-eyebrow">ACCOUNT RECOVERY</p>
        <h1>Reset your password</h1>
        <p>Enter the email address linked to your partner account.</p>
        <form class="auth-form reset-form" data-auth-form="forgot">
          <label>Email address<input name="email" type="email" placeholder="name@company.com" autocomplete="email" value="${safeEmail}" required></label>
          <button class="auth-submit" type="submit">Continue</button>
        </form>
        <button class="auth-back-link" type="button" data-auth-view="signin">Back to sign in</button>
      </section>`,
    resetSent: `
      <section class="auth-single-card">
        <div class="verify-icon" aria-hidden="true">✓</div>
        <p class="auth-eyebrow">ACCOUNT RECOVERY</p>
        <h1>Next steps</h1>
        <p>If <strong>${safeEmail}</strong> is linked to a partner account, password reset instructions would be sent to that address.</p>
        <div class="demo-info"><strong>Prototype preview</strong><span>Password recovery email delivery is not connected.</span></div>
        <button class="auth-submit" type="button" data-auth-view="signin">Return to sign in</button>
      </section>`,
    help: `
      <section class="auth-single-card">
        <div class="verify-icon reset-icon" aria-hidden="true">?</div>
        <p class="auth-eyebrow">PARTNER SUPPORT</p>
        <h1>We’re here to help</h1>
        <p>For help signing in or creating an account, contact your Fidelity Stay partner support team.</p>
        <div class="demo-info"><strong>Support hours</strong><span>Monday–Friday · 08:00–18:00 SAST<br>support@fidelity.stay</span></div>
        <button class="auth-submit" type="button" data-auth-view="signin">Return to sign in</button>
      </section>`,
  };

  authRoot.innerHTML = views[view] || views.signin;
  document.title = `${view === "signin" ? "Sign in" : view === "signup" ? "Create account" : "Fidelity Stay account"} · Fidelity.Stay ExtraNet`;
  const firstInput = authRoot.querySelector("input");
  if (view === "signin" && email) firstInput?.focus();
}

function enterDemo(account) {
  currentAccount = account;
  if (!Array.isArray(currentAccount.properties)) currentAccount.properties = [];
  syncProperties();
  updatePropertySwitcher();
  authShell.hidden = true;
  appShell.hidden = false;
  const fullName = account.name || account.email;
  const initials = fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  document.querySelector(".profile-signout-copy strong").textContent = fullName;
  document.querySelector(".profile-signout-copy small").textContent = account.email;
  document.querySelector(".profile-signout .avatar").textContent = initials;
  const initialPage = location.hash.slice(1);
  renderPage(pageViews[initialPage] ? initialPage : "overview");
}

function getCalendarDates() {
  const property = getSelectedProperty();
  const baseDate = property?.availableFrom
    ? new Date(`${property.availableFrom}T00:00:00`)
    : new Date();
  const start = new Date(Date.UTC(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate() - ((baseDate.getDay() + 6) % 7) + calendarWeekOffset * 7,
  ));
  const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
  const monthFormat = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const month = monthFormat.format(start) === monthFormat.format(end)
    ? monthFormat.format(start)
    : `${monthFormat.format(start)} – ${monthFormat.format(end)}`;

  return {
    month,
    dates: Array.from({ length: 7 }, (_, index) =>
      new Date(start.getTime() + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)),
    labels: Array.from({ length: 7 }, (_, index) =>
      new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" })
        .format(new Date(start.getTime() + index * 24 * 60 * 60 * 1000))),
  };
}

const pageInfo = {
  overview: ["Your business at a glance", "Hey there", "A clear view of today's activity across your properties.", "Add a property"],
  properties: ["Portfolio", "Your properties", "Manage listing details, room types and property status.", "Add a property"],
  reservations: ["Guest stays", "Reservations", "Review upcoming stays and keep every booking on track.", "Export reservations"],
  calendar: ["Inventory", "Calendar & availability", "Update room availability for the dates that matter.", "Update availability"],
  rates: ["Pricing", "Rates & plans", "Keep rates and restrictions aligned across your room inventory.", "Create rate plan"],
  guests: ["Relationships", "Guest directory", "See guest history and prepare for their next stay.", "Export guest list"],
  finance: ["Payouts", "Finance & payments", "Track your earnings, payout schedule and transaction history.", "Download statement"],
  analytics: ["Insights", "Performance", "Understand demand, occupancy and revenue across your portfolio.", "Export report"],
  messages: ["Inbox", "Guest messages", "Respond to guest questions and keep conversations in one place.", "New message"],
  settings: ["Workspace", "Settings", "Manage property information, team access and account preferences.", "Save changes"],
  help: ["Fidelity Stay support", "How can we help?", "Find practical guidance or get help from our partner support team.", "Contact support"],
  "property-setup": ["New listing", "List your property", "Tell us about your place and set the dates guests can stay.", "Continue"],
};

const statusClass = (status) => {
  if (status === "Confirmed" || status === "Active" || status === "Paid") return "confirmed";
  if (status === "Awaiting payment" || status === "Setup needed" || status === "Processing") return "pending";
  if (status === "Checked in") return "checkedin";
  if (status === "Cancelled") return "cancelled";
  return "pending";
};

const heading = (page) => {
  const [eyebrow, title, description, action] = pageInfo[page];
  const pageTitle = page === "overview"
    ? currentAccount
      ? `Hey, ${escapeHTML(currentAccount.name.split(/\s+/)[0])}`
      : "Hey there"
    : title;
  const actionType = page === "reservations" || page === "guests" || page === "finance" || page === "analytics"
    ? "export"
    : page === "help" || page === "messages"
      ? "support"
      : page === "settings"
        ? "save"
        : page === "overview" || page === "properties"
          ? "start-property"
      : "primary";

  return `
    <header class="page-heading">
      <div>
        <p class="eyebrow accent">${eyebrow}</p>
        <h1>${pageTitle}</h1>
        <p class="subhead">${description}</p>
      </div>
      <button class="primary-btn" type="button" data-action="${actionType}" data-action-page="${page}">${action}</button>
    </header>`;
};

const statCard = (label, value, note, tone = "") => `
  <article class="stat-card ${tone}">
    <div class="stat-label-row"><span>${label}</span></div>
    <strong>${value}</strong>
    <small>${note}</small>
  </article>`;

const bookingRows = (rows = bookings) => rows.map((booking) => `
  <tr>
    <td class="reference-cell">#${booking.ref}</td>
    <td>${booking.guest}</td>
    <td>${booking.property}</td>
    <td>${booking.arrival}</td>
    <td>${booking.departure}</td>
    <td>${booking.amount}</td>
    <td><span class="status-pill ${statusClass(booking.status)}">${booking.status}</span></td>
  </tr>`).join("");

const bookingTable = (rows = bookings) => `
  <div class="table-scroll">
    <table>
      <thead><tr><th>Reference</th><th>Guest</th><th>Property</th><th>Check-in</th><th>Check-out</th><th>Total</th><th>Status</th></tr></thead>
      <tbody>${bookingRows(rows)}</tbody>
    </table>
  </div>`;

function startPropertySetup() {
  propertySetupStep = 1;
  propertyDraft = blankPropertyDraft();
  propertyDraftPhotos = [];
  renderPage("property-setup");
}

function propertySetupView() {
  const steps = ["Property", "Rooms & stays", "Photos & review"];
  const progress = `<div class="setup-progress">${steps.map((step, index) => `<span class="${propertySetupStep === index + 1 ? "active" : propertySetupStep > index + 1 ? "complete" : ""}"><b>${propertySetupStep > index + 1 ? "✓" : index + 1}</b>${step}</span>`).join("")}</div>`;
  const photoPreview = propertyDraftPhotos.map((photo, index) => `<div class="setup-photo"><img src="${photo.data}" alt="Selected property photo ${index + 1}"><button type="button" aria-label="Remove photo ${index + 1}" data-remove-photo="${index}">×</button></div>`).join("");

  let stepContent = "";
  if (propertySetupStep === 1) {
    stepContent = `
      <div class="setup-section-title"><p class="eyebrow accent">STEP 1 OF 3</p><h2>Tell us about your property</h2><p>Start with the details guests need to find and understand your place.</p></div>
      <div class="form-grid setup-form-grid">
        <label>Property name<input name="name" value="${escapeHTML(propertyDraft.name)}" placeholder="e.g. Seaside Guest House" required></label>
        <label>Type of accommodation<select name="type" required><option value="">Choose a property type</option>${["Hotel", "Guesthouse", "Bed and breakfast", "Apartment", "Holiday home", "Lodge", "Hostel", "Other"].map((type) => `<option ${propertyDraft.type === type ? "selected" : ""}>${type}</option>`).join("")}</select></label>
        <label>Country or region<input name="country" value="${escapeHTML(propertyDraft.country)}" placeholder="e.g. South Africa" required></label>
        <label>City or town<input name="city" value="${escapeHTML(propertyDraft.city)}" placeholder="e.g. Cape Town" required></label>
        <label class="full-width">Street address<input name="address" value="${escapeHTML(propertyDraft.address)}" placeholder="Street address and number" required></label>
        <label>Check-in from<input name="checkIn" type="time" value="${escapeHTML(propertyDraft.checkIn)}" required></label>
        <label>Check-out by<input name="checkOut" type="time" value="${escapeHTML(propertyDraft.checkOut)}" required></label>
        <label class="full-width">About your property<textarea name="description" rows="3" placeholder="What should guests know about your accommodation?">${escapeHTML(propertyDraft.description)}</textarea></label>
      </div>`;
  } else if (propertySetupStep === 2) {
    stepContent = `
      <div class="setup-section-title"><p class="eyebrow accent">STEP 2 OF 3</p><h2>Set up your rooms and stays</h2><p>Choose your room inventory, nightly price and the dates you can welcome guests.</p></div>
      <div class="form-grid setup-form-grid">
        <label>Room or unit name<input name="roomName" value="${escapeHTML(propertyDraft.roomName)}" placeholder="e.g. Double room" required></label>
        <label>Number of rooms or units<input name="roomCount" type="number" min="1" max="500" value="${escapeHTML(propertyDraft.roomCount)}" required></label>
        <label>Maximum guests per room<input name="guestsPerRoom" type="number" min="1" max="30" value="${escapeHTML(propertyDraft.guestsPerRoom)}" required></label>
        <label>Nightly base rate<input name="baseRate" type="number" min="1" step="0.01" value="${escapeHTML(propertyDraft.baseRate)}" placeholder="e.g. 1200" required></label>
        <label>Rate currency<select name="currency"><option value="ZAR" ${propertyDraft.currency === "ZAR" ? "selected" : ""}>ZAR · South African rand</option><option value="USD" ${propertyDraft.currency === "USD" ? "selected" : ""}>USD · US dollar</option><option value="EUR" ${propertyDraft.currency === "EUR" ? "selected" : ""}>EUR · Euro</option><option value="GBP" ${propertyDraft.currency === "GBP" ? "selected" : ""}>GBP · Pound sterling</option></select></label>
        <label>Minimum nights per stay<input name="minimumStay" type="number" min="1" max="365" value="${escapeHTML(propertyDraft.minimumStay)}" required></label>
        <label>First available date<input name="availableFrom" type="date" min="${new Date().toISOString().slice(0, 10)}" value="${escapeHTML(propertyDraft.availableFrom)}" required></label>
        <label>Last available date<input name="availableUntil" type="date" min="${escapeHTML(propertyDraft.availableFrom)}" value="${escapeHTML(propertyDraft.availableUntil)}" required></label>
      </div>
      <div class="inline-notice"><span>ⓘ</span><p>Your dates and rates are saved as listing details. This demo does not publish the property or receive real guest bookings.</p></div>`;
  } else {
    stepContent = `
      <div class="setup-section-title"><p class="eyebrow accent">STEP 3 OF 3</p><h2>Add photos and review</h2><p>Photos help guests picture their stay. Add up to five images, then check your listing details.</p></div>
      <label class="photo-upload-zone"><input type="file" accept="image/*" multiple data-property-photos><span class="photo-upload-icon">↑</span><strong>Choose property photos</strong><small>JPG, PNG or WebP · up to 8 MB each · maximum 5 photos</small></label>
      ${photoPreview ? `<div class="setup-photo-grid">${photoPreview}</div>` : `<p class="photo-optional-note">Photos are optional. You can save the property without adding images.</p>`}
      <div class="listing-review">
        <div class="panel-header"><div><p class="eyebrow">LISTING PREVIEW</p><h3>${escapeHTML(propertyDraft.name || "Your property")}</h3></div><span class="status-pill pending">Not published</span></div>
        <div class="review-grid"><span><small>Accommodation</small><strong>${escapeHTML(propertyDraft.type || "Not set")}</strong></span><span><small>Location</small><strong>${escapeHTML([propertyDraft.city, propertyDraft.country].filter(Boolean).join(", ") || "Not set")}</strong></span><span><small>Rooms</small><strong>${escapeHTML(propertyDraft.roomCount || "1")} × ${escapeHTML(propertyDraft.roomName || "Room")}</strong></span><span><small>Rate</small><strong>${escapeHTML(propertyDraft.currency)} ${escapeHTML(propertyDraft.baseRate || "0")} per night</strong></span><span><small>Available for stays</small><strong>${escapeHTML(propertyDraft.availableFrom || "—")} to ${escapeHTML(propertyDraft.availableUntil || "—")}</strong></span><span><small>Guest capacity</small><strong>Up to ${escapeHTML(propertyDraft.guestsPerRoom || "2")} per room · minimum ${escapeHTML(propertyDraft.minimumStay || "1")} night(s)</strong></span></div>
      </div>`;
  }

  return `
    <header class="page-heading setup-page-heading"><div><p class="eyebrow accent">PROPERTY SETUP</p><h1>Add a property</h1>    <p class="subhead">Add your property details, rooms, rates and available stay dates.</p></div><button class="secondary-btn" type="button" data-action="cancel-property">Cancel</button></header>
    ${progress}
    <form class="panel property-setup-panel" id="property-setup-form" novalidate>
      ${stepContent}
      <div class="setup-form-footer">
        <button class="secondary-btn" type="button" data-setup-back ${propertySetupStep === 1 ? "disabled" : ""}>Back</button>
        <span>Step ${propertySetupStep} of 3</span>
        ${propertySetupStep < 3
          ? `<button class="primary-btn" type="button" data-setup-next>Continue</button>`
          : `<button class="primary-btn" type="button" data-setup-finish>Save property</button>`}
      </div>
    </form>`;
}

const pageViews = {
  overview: () => `
    ${heading("overview")}
    <section class="stats-grid overview-stats">
      ${statCard("Guest stays", String(bookings.length), "Bookings appear here when guests reserve")}
      ${statCard("Properties", String(properties.length), properties.length ? "In your portfolio" : "Add your first property")}
      ${statCard("Occupancy", "0%", "No guest stays yet")}
      ${statCard("Revenue", "R 0", "Earnings will appear after a stay", "emphasis")}
    </section>
    ${properties.length
      ? `<section class="panel"><div class="panel-header"><div><p class="eyebrow">Your first listing</p><h3>${escapeHTML(properties[0][0])}</h3></div><button class="text-btn" type="button" data-page="properties">Manage properties →</button></div><p class="setup-summary">${escapeHTML(properties[0][1])} · ${escapeHTML(properties[0][2])} · Opens for stays ${escapeHTML(properties[0][5].availableFrom)}–${escapeHTML(properties[0][5].availableUntil)}</p><div class="content-grid dashboard-grid"><div><p class="eyebrow">Reservations</p>${bookings.length ? bookingTable() : propertyEmptyState("No guest stays yet", "Your reservation list will fill in when travellers book your property.", "Review availability")}</div><div><p class="eyebrow">Guest directory</p>${guests.length ? "" : `<p class="zero-note">0 guests · guest profiles appear after the first completed booking.</p>`}</div></div></section>`
      : `<section class="panel first-property-panel"><div class="first-property-mark">⌂</div><p class="eyebrow accent">LET'S GET STARTED</p><h2>Bring your property to Fidelity Stay</h2><p>Add your accommodation, room details, photos and the dates you’re open to guests. You can review everything before saving.</p><div class="onboarding-steps"><span><b>1</b><strong>Tell us about your place</strong></span><span><b>2</b><strong>Add rooms &amp; rates</strong></span><span><b>3</b><strong>Set your stay dates</strong></span><span><b>4</b><strong>Add property photos</strong></span></div><button class="primary-btn" type="button" data-action="start-property">Add your first property</button></section>
      <section class="panel empty-bookings-panel"><p class="eyebrow">Guest activity</p><h3>Guests and reservations start at zero</h3><p>Once you have a property ready for stays, guest bookings and reservation details will appear here. There are no sample guests or bookings in this account.</p></section>`}`,

  properties: () => `
    ${heading("properties")}
    ${properties.length
      ? `<section class="property-toolbar panel"><label class="search-field"><span>⌕</span><input type="search" placeholder="Find a property" data-filter="properties" aria-label="Find a property"></label><span class="result-count">${properties.length} ${properties.length === 1 ? "property" : "properties"}</span></section>
      <section class="property-grid">${properties.map((property, index) => `
        <article class="panel property-card" data-property="${escapeHTML(property[0].toLowerCase())}">
          <div class="property-cover cover-${index % 4 + 1}">${property[5].photos?.[0] ? `<img src="${property[5].photos[0].data}" alt="${escapeHTML(property[0])}">` : ""}<span class="status-pill confirmed">Saved in your account</span></div>
          <div class="property-card-content"><div class="property-title-row"><div><h3>${escapeHTML(property[0])}</h3><p>${escapeHTML(property[1])}</p></div><button class="icon-button compact" aria-label="More actions for ${escapeHTML(property[0])}" type="button" data-toast="Property actions are ready to configure.">···</button></div>
          <div class="property-card-meta"><span>${escapeHTML(property[2])}</span><span>${property[5].photos?.length || 0} photos</span><span>${escapeHTML(property[5].currency)} ${escapeHTML(property[5].baseRate)} / night</span></div><div class="property-card-actions"><button class="secondary-btn small" type="button" data-page="settings">Edit account settings</button><button class="text-btn" type="button" data-page="calendar">Open stays calendar →</button></div></div>
        </article>`).join("")}</section>
      <button class="secondary-btn add-another-property" type="button" data-action="start-property">+ Add another property</button>`
      : `<section class="panel">${propertyEmptyState("Your property portfolio starts here", "You have 0 properties. Add a listing to describe your accommodation, room inventory, nightly rate, and the dates you can host guests.")}</section>`}`,

  reservations: () => `
    ${heading("reservations")}
    <section class="stats-grid compact-stats">${statCard("Guest stays", "0", "No reservations yet")}${statCard("Arrivals", "0", "No upcoming check-ins")}${statCard("Departures", "0", "No upcoming check-outs")}</section>
    <section class="panel">${propertyEmptyState("0 reservations", properties.length ? "There are no guest bookings yet. Reservations will appear here when your first guest books a stay." : "Add a property and choose the dates it is available. Guest reservations will appear here when travellers book.", properties.length ? "Manage properties" : "Add your first property")}</section>`,

  "property-setup": () => propertySetupView(),

  calendar: () => {
    if (!properties.length) {
      return `${heading("calendar")}<section class="panel">${propertyEmptyState("Set up your first stay calendar", "Add your rooms, nightly rates and the dates you’re open to guests to start managing availability.")}</section>`;
    }
    const { month, labels, dates } = getCalendarDates();
    const property = getSelectedProperty();
    const room = property.roomName;
    return `${heading("calendar")}
      <section class="calendar-controls panel"><div><p class="eyebrow">${escapeHTML(property.name)} · Open for stays</p><h3 class="calendar-month" id="calendar-month">${month}</h3><p class="setup-summary">Your stay dates: ${escapeHTML(property.availableFrom)} to ${escapeHTML(property.availableUntil)} · Minimum ${escapeHTML(property.minimumStay)} night(s)</p></div><div class="calendar-actions"><button class="secondary-btn small" type="button" data-month="-1" aria-label="Previous week">←</button><button class="secondary-btn small" type="button" data-month="0">This week</button><button class="secondary-btn small" type="button" data-month="1" aria-label="Next week">→</button><select aria-label="Select property">${properties.map((item) => `<option value="${item[5].id}" ${item[5].id === property.id ? "selected" : ""}>${escapeHTML(item[0])}</option>`).join("")}</select></div></section>
      <section class="panel calendar-panel"><div class="calendar-grid calendar-heading"><div class="room-heading">Room type · ${escapeHTML(property.roomCount)} units</div>${labels.map((day) => `<div class="calendar-date">${day}</div>`).join("")}</div>
      <div class="calendar-grid calendar-room"><div class="room-label"><strong>${escapeHTML(room)}</strong><small>${escapeHTML(property.currency)} ${escapeHTML(property.baseRate)} · per night</small></div>${dates.map((date) => {
        const isAvailable = date >= property.availableFrom && date <= property.availableUntil;
        return `<button class="calendar-cell ${isAvailable ? "" : "sold-out"}" type="button" ${isAvailable ? 'data-toast="Availability management for live bookings will be enabled when your listing is connected."' : 'disabled'}><strong>${isAvailable ? `${escapeHTML(property.roomCount)} available` : "Closed"}</strong><small>${isAvailable ? `${escapeHTML(property.currency)} ${escapeHTML(property.baseRate)}` : "Outside stay dates"}</small></button>`;
      }).join("")}</div>
      <div class="calendar-legend"><span><i class="legend-dot available"></i> Available to book</span><span>${escapeHTML(property.availableFrom)} – ${escapeHTML(property.availableUntil)}</span><span>Guest reservations are not connected in this demo</span></div></section>`;
  },

  rates: () => {
    if (!properties.length) {
      return `${heading("rates")}<section class="panel">${propertyEmptyState("Set your first nightly rate", "Add a property and decide how many rooms you can host, what each night costs, and which dates are open.")}</section>`;
    }
    const property = getSelectedProperty();
    return `${heading("rates")}
      <section class="stats-grid compact-stats">${statCard("Room types", "1", "Configured for this property")}${statCard("Base nightly rate", `${escapeHTML(property.currency)} ${escapeHTML(property.baseRate)}`, escapeHTML(property.roomName))}${statCard("Minimum stay", `${escapeHTML(property.minimumStay)} night(s)`, `${escapeHTML(property.availableFrom)} – ${escapeHTML(property.availableUntil)}`)}</section>
      <section class="panel"><div class="panel-header"><div><p class="eyebrow">${escapeHTML(property.name)}</p><h3>Your room and rate</h3></div><button class="text-btn" type="button" data-page="calendar">View availability →</button></div>
      <div class="rate-plan-list"><article class="rate-plan"><div><h4>${escapeHTML(property.roomName)}</h4><p>${escapeHTML(property.guestsPerRoom)} guests per room · Minimum ${escapeHTML(property.minimumStay)} night(s)</p></div><strong>${escapeHTML(property.currency)} ${escapeHTML(property.baseRate)} <small>/ night</small></strong><span>${escapeHTML(property.roomCount)} room(s)</span><span class="status-pill confirmed">Saved</span></article></div>
      <div class="inline-notice"><span>ⓘ</span><p>Rates and stay dates are stored in this browser profile. Connecting live rates and reservations requires a booking backend.</p></div></section>`;
  },

  guests: () => properties.length ? `
    ${heading("guests")}
    <section class="stats-grid compact-stats">${statCard("Guest profiles", "0", "Guests appear after a booking")}${statCard("Returning guests", "0", "No completed stays yet")}${statCard("Arriving this week", "0", "No upcoming check-ins")}</section>
    <section class="panel">${propertyEmptyState("No guests yet", "Your guest list starts at zero. Guest profiles appear here after travellers book and stay at your property.", "View reservations")}</section>`
    : `${heading("guests")}<section class="panel">${propertyEmptyState("Your guest list starts at zero", "First add a property and specify your available stay dates. Guest profiles will appear when travellers book.", "Add your first property")}</section>`,

  finance: () => `
    ${heading("finance")}
    <section class="finance-summary">
      <article class="balance-card"><p class="eyebrow">Guest payouts</p><strong>R 0.00</strong><span>Payout details are not connected in this prototype.</span><button class="secondary-btn small" type="button" data-page="settings">Manage account settings</button></article>
      <div class="finance-stat-grid">${statCard("Gross earnings", "R 0", "No completed stays")}${statCard("Service fees", "R 0", "No reservations yet")}${statCard("Payouts completed", "R 0", "No payouts yet")}</div>
    </section>
    <section class="panel">${propertyEmptyState("No transactions yet", "Transactions will be listed here after guests book stays and payouts are connected.", properties.length ? "View reservations" : "Add your first property")}</section>`,

  analytics: () => `
    ${heading("analytics")}
    <section class="stats-grid analytics-stats">${statCard("Gross revenue", "R 0", "No completed stays", "emphasis")}${statCard("Room nights sold", "0", "No guest reservations")}${statCard("Occupancy", "0%", "No stays recorded")}${statCard("Average nightly rate", properties.length ? `${escapeHTML(properties[0][5].currency)} ${escapeHTML(properties[0][5].baseRate)}` : "—", "Your saved base rate")}</section>
    <section class="panel">${propertyEmptyState("Performance reports will grow with your business", properties.length ? "You have 0 guest stays and 0 guests. Your booking, occupancy and revenue reports will populate as real stay data becomes available." : "Add your first property, set its rate and stay dates, then performance reporting can grow with your guest stays.", properties.length ? "View reservations" : "Add your first property")}</section>`,

  messages: () => `${heading("messages")}<section class="panel">${propertyEmptyState("Your inbox is quiet", properties.length ? "Guest conversations will appear here when travellers contact you about a stay. There are no guest messages yet." : "Add your property and set available stay dates. Guest conversations will appear after travellers enquire about a stay.", properties.length ? "View reservations" : "Add your first property")}</section>`,

  settings: () => {
    const accountName = currentAccount?.name || "Partner";
    const accountNameParts = accountName.split(/\s+/);
    const safeAccountName = escapeHTML(accountName);
    const property = getSelectedProperty();
    const accountInitials = accountNameParts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
    const firstName = escapeHTML(accountNameParts[0] || "");
    const lastName = escapeHTML(accountNameParts.slice(1).join(" "));
    const accountEmail = escapeHTML(currentAccount?.email || "");
    const propertyName = escapeHTML(property?.name || "");
    return `
    ${heading("settings")}
    <section class="settings-layout"><nav class="settings-nav" aria-label="Settings sections"><a class="selected" href="#property-details">Property details</a><a href="#account-details">Account details</a><a href="#team-access">Team access</a><a href="#notifications">Notifications</a><a href="#payments">Payout details</a></nav>
    <form class="panel settings-form" id="settings-form"><section id="property-details" class="settings-section"><div class="panel-header"><div><p class="eyebrow">${propertyName || "No property selected"}</p><h3>Property details</h3></div>${property ? `<span class="status-pill confirmed">Saved</span>` : ""}</div>
      ${property ? `<div class="form-grid"><label>Property name<input value="${propertyName}" readonly></label><label>Property type<input value="${escapeHTML(property.type)}" readonly></label><label class="full-width">Street address<input value="${escapeHTML(property.address)}" readonly></label><label>City<input value="${escapeHTML(property.city)}" readonly></label><label>Country / region<input value="${escapeHTML(property.country)}" readonly></label><label>Check-in from<input type="time" value="${escapeHTML(property.checkIn)}" readonly></label><label>Check-out by<input type="time" value="${escapeHTML(property.checkOut)}" readonly></label></div><p class="zero-note">Property edits are managed in the listing workflow.</p>` : propertyEmptyState("Add a property to manage its details", "Your accommodation address, rooms and stay details appear here after you create a listing.")}</section>
      <section id="account-details" class="settings-section"><div class="panel-header"><div><p class="eyebrow">Your profile</p><h3>Account details</h3></div></div><div class="form-grid"><label>First name<input value="${firstName}"></label><label>Last name<input value="${lastName}"></label><label>Email address<input type="email" value="${accountEmail}" readonly></label><label>Preferred language<select><option>English</option><option>Afrikaans</option></select></label></div></section>
      <section id="team-access" class="settings-section"><div class="panel-header"><div><p class="eyebrow">Workspace members</p><h3>Team access</h3></div><button class="secondary-btn small" type="button" data-toast="Team invitations aren’t connected in this demo.">Invite a teammate</button></div><div class="team-member"><span class="guest-avatar">${accountInitials}</span><span><strong>${safeAccountName}</strong><small>Owner · All properties</small></span><span class="status-pill confirmed">Active</span></div></section>
      <section id="notifications" class="settings-section"><div class="panel-header"><div><p class="eyebrow">Stay up to date</p><h3>Notifications</h3></div></div><label class="preference-row"><input type="checkbox" checked><span><strong>New reservation updates</strong><small>Receive an alert when a guest books or changes a stay.</small></span></label><label class="preference-row"><input type="checkbox" checked><span><strong>Guest messages</strong><small>Get notified when guests send a message.</small></span></label></section>
      <section id="payments" class="settings-section"><div class="panel-header"><div><p class="eyebrow">Payout account</p><h3>Payout details</h3></div></div><p class="zero-note">No payout account is connected. Payout setup will be available when payment services are configured.</p></section>
      <div class="form-footer"><small>Changes are saved in this browser.</small><button class="primary-btn" type="submit">Save changes</button></div>
    </form></section>`;
  },

  help: () => `
    ${heading("help")}
    <section class="help-search panel"><span>⌕</span><input type="search" placeholder="Search help articles, guides and answers" aria-label="Search help articles"><button class="primary-btn" type="button" data-toast="Enter a topic to search Fidelity Stay support.">Search help</button></section>
    <section class="help-grid">
      ${[["▣", "Property & rooms", "Update your listing, room types and photos."], ["▤", "Reservations", "Manage bookings, changes and cancellations."], ["◷", "Rates & availability", "Set prices, restrictions and open dates."], ["R", "Payments & invoices", "Understand payouts, fees and statements."], ["✉", "Guest communication", "Keep in touch before and during a stay."], ["⚙", "Account & security", "Manage users, access and account details."]].map((item) => `<button class="panel help-card" type="button" data-toast="${item[1]} guide opened."><span class="help-icon">${item[0]}</span><span><strong>${item[1]}</strong><small>${item[2]}</small><b>Browse articles →</b></span></button>`).join("")}
    </section>
    <section class="contact-banner"><div><p class="eyebrow">We're here to help</p><h3>Need a hand with something specific?</h3><p>Our partner support team can help you get things sorted.</p></div><button class="secondary-btn" type="button" data-toast="Support request form opened.">Contact partner support</button></section>`,
};

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showToast.timeoutId);
  showToast.timeoutId = setTimeout(() => toast.classList.remove("visible"), 2600);
}

function renderPage(page) {
  const pageKey = pageViews[page] ? page : "overview";
  activePage = pageKey;
  const render = pageViews[pageKey];
  const pageTitle = pageKey === "overview"
    ? currentAccount
      ? `Hey, ${escapeHTML(currentAccount.name.split(/\s+/)[0])}`
      : "Hey there"
    : pageInfo[pageKey][1];
  pageRoot.innerHTML = render();
  navigation.forEach((item) => {
    const isActive = item.dataset.page === pageKey;
    item.classList.toggle("active", isActive);
    if (isActive) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  document.title = `${pageTitle} · Fidelity.Stay ExtraNet`;
  history.replaceState(null, "", `#${pageKey}`);
}

function exportCurrentPage() {
  const reports = {
    reservations: {
      filename: "fidelity-stay-reservations.csv",
      columns: ["Reference", "Guest", "Property", "Check-in", "Check-out", "Total", "Status"],
      rows: bookings.map((booking) => [booking.ref, booking.guest, booking.property, booking.arrival, booking.departure, booking.amount, booking.status]),
    },
    guests: {
      filename: "fidelity-stay-guests.csv",
      columns: ["Guest", "Property", "Previous stays", "Most recent activity"],
      rows: guests,
    },
    finance: {
      filename: "fidelity-stay-transactions.csv",
      columns: ["Description", "Reference", "Date", "Type", "Amount", "Status"],
      rows: [],
    },
    analytics: {
      filename: "fidelity-stay-performance.csv",
      columns: ["Property", "Occupancy"],
      rows: properties.map((property) => [property[0], property[3]]),
    },
  };
  const report = reports[activePage] || reports.reservations;
  const lines = report.rows;
  const csv = [report.columns, ...lines].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = report.filename;
  link.click();
  URL.revokeObjectURL(url);
  showToast("Your export is ready.");
}

document.addEventListener("click", (event) => {
  const authViewControl = event.target.closest("[data-auth-view]");
  if (authViewControl) {
    renderAuth(authViewControl.dataset.authView, authViewControl.dataset.authEmail || "");
    return;
  }

  const settingsLink = event.target.closest(".settings-nav a");
  if (settingsLink) {
    event.preventDefault();
    document.querySelectorAll(".settings-nav a").forEach((link) => link.classList.toggle("selected", link === settingsLink));
    document.getElementById(settingsLink.hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  const target = event.target.closest("button");
  if (!target) return;

  if (target.dataset.togglePassword) {
    const password = document.getElementById(target.dataset.togglePassword);
    if (password) {
      const visible = password.type === "password";
      password.type = visible ? "text" : "password";
      target.textContent = visible ? "Hide" : "Show";
      target.setAttribute("aria-label", `${visible ? "Hide" : "Show"} password`);
    }
    return;
  }

  if (target.dataset.authAction === "signout") {
    currentAccount = null;
    appShell.hidden = true;
    authShell.hidden = false;
    renderAuth("signin");
    window.scrollTo(0, 0);
    return;
  }

  if (target.dataset.action === "start-property") {
    startPropertySetup();
    return;
  }
  if (target.dataset.action === "cancel-property") {
    renderPage(properties.length ? "properties" : "overview");
    return;
  }
  if (target.matches("[data-setup-next]")) {
    const form = document.getElementById("property-setup-form");
    const endDate = form.elements.availableUntil;
    if (form.elements.availableFrom) {
      endDate.setCustomValidity(
        !endDate.value || endDate.value > form.elements.availableFrom.value
          ? ""
          : "The last available date must be after the first available date.",
      );
    }
    if (!form.reportValidity()) return;
    capturePropertyDraft(form);
    propertySetupStep = Math.min(3, propertySetupStep + 1);
    renderPage("property-setup");
    return;
  }
  if (target.matches("[data-setup-back]")) {
    capturePropertyDraft(document.getElementById("property-setup-form"));
    propertySetupStep = Math.max(1, propertySetupStep - 1);
    renderPage("property-setup");
    return;
  }
  if (target.matches("[data-setup-finish]")) {
    capturePropertyDraft(document.getElementById("property-setup-form"));
    const startDate = new Date(`${propertyDraft.availableFrom}T00:00:00`);
    const endDate = new Date(`${propertyDraft.availableUntil}T00:00:00`);
    if (!propertyDraft.name || !propertyDraft.city || !propertyDraft.roomName || !propertyDraft.baseRate
      || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
      showToast("Check the property, room and availability details before saving.");
      propertySetupStep = !propertyDraft.name || !propertyDraft.city ? 1 : 2;
      renderPage("property-setup");
      document.getElementById("property-setup-form").reportValidity();
      return;
    }
    try {
      const property = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ...propertyDraft,
        roomCount: Number(propertyDraft.roomCount),
        guestsPerRoom: Number(propertyDraft.guestsPerRoom),
        baseRate: Number(propertyDraft.baseRate),
        minimumStay: Number(propertyDraft.minimumStay),
        photos: propertyDraftPhotos,
        createdAt: new Date().toISOString(),
      };
      currentAccount.properties.push(property);
      saveCurrentAccount();
      syncProperties();
      selectedPropertyId = property.id;
      updatePropertySwitcher();
      renderPage("properties");
      showToast("Your property was saved to this browser account.");
    } catch (error) {
      const form = document.getElementById("property-setup-form");
      showAuthError(form, error instanceof Error ? error.message : "The property could not be saved.");
    }
    return;
  }
  if (target.hasAttribute("data-remove-photo")) {
    propertyDraftPhotos.splice(Number(target.dataset.removePhoto), 1);
    renderPage("property-setup");
    return;
  }

  if (target.matches(".nav-item[data-page]")) {
    renderPage(target.dataset.page);
    return;
  }
  if (target.dataset.page) {
    renderPage(target.dataset.page);
    return;
  }
  if (target.dataset.action === "export") {
    exportCurrentPage();
    return;
  }
  if (target.dataset.action === "primary") {
    if (activePage === "messages") document.querySelector(".reply-form textarea")?.focus();
    else showToast("This action is a preview and isn’t connected to a live account.");
    return;
  }
  if (target.dataset.action === "support") {
    renderPage("help");
    return;
  }
  if (target.dataset.action === "save") {
    document.getElementById("settings-form")?.requestSubmit();
    return;
  }
  if (target.dataset.action === "search") {
    let searchInput = document.querySelector('[data-filter="reservations"], [data-filter="guests"], [data-filter="properties"]');
    if (!searchInput) {
      renderPage("reservations");
      searchInput = document.querySelector('[data-filter="reservations"]');
    }
    searchInput?.focus();
    return;
  }
  if (target.dataset.statusFilter) {
    const status = target.dataset.statusFilter;
    document.querySelectorAll(".filter-tab").forEach((tab) => tab.classList.toggle("active", tab === target));
    const filtered = status === "All" ? bookings : bookings.filter((booking) => booking.status === status);
    document.querySelector("#reservation-table").innerHTML = bookingTable(filtered);
    return;
  }
  if (target.dataset.month) {
    calendarWeekOffset = target.dataset.month === "0" ? 0 : calendarWeekOffset + Number(target.dataset.month);
    const { month, labels } = getCalendarDates();
    document.getElementById("calendar-month").textContent = month;
    document.querySelectorAll(".calendar-date").forEach((date, index) => {
      date.textContent = labels[index];
    });
    return;
  }
  if (target.dataset.conversation) {
    document.querySelectorAll(".conversation").forEach((conversation) => conversation.classList.toggle("selected", conversation === target));
    document.getElementById("thread-name").textContent = target.dataset.conversation;
    return;
  }
  if (target.dataset.toast) showToast(target.dataset.toast);
});

document.addEventListener("input", (event) => {
  const input = event.target;
  const signupForm = input.closest('[data-auth-form="signup"]');
  if (signupForm && (input.name === "password" || input.name === "confirm-password")) {
    const password = signupForm.elements.password;
    const confirmation = signupForm.elements["confirm-password"];
    confirmation.setCustomValidity(
      !confirmation.value || confirmation.value === password.value ? "" : "Passwords do not match.",
    );
  }

  if (input.dataset.filter === "reservations") {
    const query = input.value.trim().toLowerCase();
    const filtered = bookings.filter((booking) => Object.values(booking).some((value) => value.toLowerCase().includes(query)));
    document.querySelector("#reservation-table").innerHTML = bookingTable(filtered);
  } else if (input.dataset.filter === "guests") {
    const query = input.value.trim().toLowerCase();
    document.querySelectorAll("[data-guest]").forEach((row) => {
      row.hidden = !row.dataset.guest.includes(query);
    });
  } else if (input.dataset.filter === "properties") {
    const query = input.value.trim().toLowerCase();
    document.querySelectorAll("[data-property]").forEach((card) => {
      card.hidden = !card.dataset.property.includes(query);
    });
  }
});

document.addEventListener("change", async (event) => {
  if (event.target.matches("[data-property-photos]")) {
    const files = Array.from(event.target.files || []);
    if (files.length + propertyDraftPhotos.length > 5) {
      showToast("Choose up to 5 photos in total.");
      event.target.value = "";
      return;
    }
    try {
      const photos = await Promise.all(files.map(compressPhoto));
      propertyDraftPhotos.push(...photos);
      renderPage("property-setup");
    } catch (error) {
      showAuthError(document.getElementById("property-setup-form"), error instanceof Error ? error.message : "The photos could not be added.");
    }
    return;
  }

  if (event.target.matches(".property-select, .calendar-actions select")) {
    const chosenPropertyId = event.target.value;
    if (properties.some((property) => property[5].id === chosenPropertyId)) {
      selectedPropertyId = chosenPropertyId;
      updatePropertySwitcher();
      if (event.target.matches(".calendar-actions select")) renderPage("calendar");
      else showToast(`Viewing ${getSelectedProperty().name}.`);
    }
    return;
  }

  if (event.target.matches("[data-filter-status]")) {
    const status = event.target.value;
    document.querySelectorAll("[data-property]").forEach((card) => {
      card.hidden = status !== "all" && card.dataset.status !== status;
    });
  }

  if (event.target.matches("#property-setup-form [name=\"availableFrom\"]")) {
    const lastDate = document.querySelector('#property-setup-form [name="availableUntil"]');
    lastDate.min = event.target.value;
    if (lastDate.value && lastDate.value <= event.target.value) lastDate.value = "";
  }
});

document.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.target.matches('[data-auth-form="signin"]')) {
    const form = event.target;
    const email = form.elements.email.value.trim().toLowerCase();
    try {
      const account = loadAccounts().find((savedAccount) => savedAccount.email === email);
      if (!account) {
        showAuthError(form, "We couldn’t find an account with those details. Create an account first or check your email.");
        return;
      }
      const submittedHash = await hashPassword(form.elements.password.value, account.salt);
      if (submittedHash !== account.passwordHash) {
        showAuthError(form, "The email or password is incorrect. Please try again.");
        return;
      }
      enterDemo(account);
      showToast("You’re signed in to the Fidelity Stay prototype.");
    } catch (error) {
      showAuthError(form, error instanceof Error ? error.message : "Sign-in failed. Please try again.");
    }
  } else if (event.target.matches('[data-auth-form="signup"]')) {
    const form = event.target;
    const password = form.elements.password;
    const confirmation = form.elements["confirm-password"];
    confirmation.setCustomValidity(password.value === confirmation.value ? "" : "Passwords do not match.");
    if (!form.reportValidity()) return;
    const email = form.elements.email.value.trim().toLowerCase();
    try {
      const accounts = loadAccounts();
      if (accounts.some((account) => account.email === email)) {
        showAuthError(form, "An account with this email already exists. Sign in instead.");
        return;
      }
      const salt = createSalt();
      const passwordHash = await hashPassword(password.value, salt);
      const account = {
        name: form.elements.name.value.trim(),
        email,
        salt,
        passwordHash,
        createdAt: new Date().toISOString(),
        properties: [],
      };
      saveAccounts([...accounts, account]);
      renderAuth("verify", email);
    } catch (error) {
      showAuthError(form, error instanceof Error ? error.message : "Account creation failed. Please try again.");
    }
  } else if (event.target.matches('[data-auth-form="forgot"]')) {
    renderAuth("resetSent", event.target.elements.email.value.trim());
  } else if (event.target.matches(".reply-form")) {
    const message = event.target.querySelector("textarea");
    if (!message.value.trim()) {
      message.focus();
      showToast("Write a message before sending.");
      return;
    }
    const bubble = document.createElement("div");
    bubble.className = "message-bubble host-message";
    bubble.textContent = message.value.trim();
    document.querySelector(".thread-content").append(bubble);
    message.value = "";
    showToast("Message added to this conversation.");
  } else if (event.target.matches("#settings-form")) {
    const form = event.target;
    if (!form.reportValidity()) return;
    const firstName = form.querySelector("#account-details input");
    const lastName = form.querySelectorAll("#account-details input")[1];
    currentAccount.name = [firstName.value.trim(), lastName.value.trim()].filter(Boolean).join(" ");
    try {
      saveCurrentAccount();
      enterDemo(currentAccount);
      renderPage("settings");
      showToast("Your account details were saved in this browser.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Account details could not be saved.");
    }
  }
});

renderAuth("signin");
