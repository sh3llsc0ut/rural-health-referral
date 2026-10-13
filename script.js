/* script.js
   SCREENS AND EVENTS ONLY.
   - It never touches localStorage directly: it asks Data (data.js).
   - It holds no urgency rules (Rules) and no validation rules (Validate).
   Because Data functions are async, we use "await" before them. */

const $ = id => document.getElementById(id);

/* Escape anything typed by users before putting it into HTML */
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* Dates are stored as ISO strings; format them only when showing them */
const fmtDate = iso => { if (!iso) return ""; const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString(); };

let facilities = [];     // every facility (where staff work and where patients can be sent)
let currentUser = null;  // the signed-in user (a copy, without password data)

const facilityById = id => facilities.find(x => String(x.id) === String(id));
const facilityName = id => { const f = facilityById(id); return f ? f.name : "Unknown facility"; };
const levelLabel = f => `Level ${f.level}: ${FACILITY_LEVELS[f.level] || "Facility"}`;
// Facilities that can receive referrals, except the one the user works at
const receivers = () => facilities.filter(f => f.receivesReferrals && (!currentUser || String(f.id) !== String(currentUser.facilityId)));
const finalUrgency = a => (a.review ? a.review.finalUrgency : a.aiUrgency);

/* Wrap async handlers so a failure shows a message instead of silently breaking.
   Real network calls fail often, so this habit matters even more with the backend. */
function safe(fn) {
  return async (...args) => {
    try { await fn(...args); }
    catch (err) { console.error(err); notify(err && err.message ? err.message : "Something went wrong. Please try again.", "error"); }
  };
}

/* ---------- Accessible messages (replaces alert()) ---------- */
function notify(msg, type) {
  const box = $("toast");
  if (!box) return;
  box.setAttribute("aria-live", type === "error" ? "assertive" : "polite");
  box.className = "toast" + (type === "error" ? " error" : "");
  box.innerHTML = `<span>${esc(msg)}</span><button type="button" id="toastClose" aria-label="Dismiss message">✕</button>`;
  $("toastClose").onclick = () => { box.innerHTML = ""; box.className = "toast"; };
}

/* ---------- Form errors: a summary at the top plus a message next to each field ---------- */
function clearErrors(form) {
  form.querySelectorAll(".field-error").forEach(n => n.remove());
  form.querySelectorAll('[aria-invalid="true"]').forEach(el => {
    el.removeAttribute("aria-invalid");
    if (el.dataset.desc) el.setAttribute("aria-describedby", el.dataset.desc);
    else el.removeAttribute("aria-describedby");
  });
  const s = form.querySelector(".error-summary");
  if (s) s.remove();
}

function showErrors(form, errors) {
  clearErrors(form);
  const ids = Object.keys(errors);
  if (!ids.length) return;

  const summary = document.createElement("div");
  summary.className = "error-summary";
  summary.setAttribute("role", "alert");
  summary.tabIndex = -1;
  summary.innerHTML = `<h2>${ids.length === 1 ? "There is 1 problem to fix" : "There are " + ids.length + " problems to fix"}</h2><ul>`
    + ids.map(id => `<li><a href="#${id}" data-field="${id}">${esc(errors[id])}</a></li>`).join("") + "</ul>";
  form.insertBefore(summary, form.firstChild);
  summary.querySelectorAll("a").forEach(a => a.addEventListener("click", ev => {
    ev.preventDefault();
    const el = $(a.dataset.field);
    if (el) el.focus();
  }));

  ids.forEach(id => {
    const el = $(id);
    if (!el) return;
    const original = el.getAttribute("aria-describedby") || "";
    el.dataset.desc = original;
    const p = document.createElement("p");
    p.className = "field-error";
    p.id = "err-" + id;
    p.innerHTML = `<strong>Error:</strong> ${esc(errors[id])}`;
    el.insertAdjacentElement("afterend", p);
    el.setAttribute("aria-invalid", "true");
    el.setAttribute("aria-describedby", (p.id + " " + original).trim());
  });
  summary.focus();
}

/* ---------- Navigation ---------- */
function show(section) {
  // Only open screens that the signed-in role may use (data.js enforces the same rules)
  if (currentUser && !(Rules.ROLE_SECTIONS[currentUser.role] || []).includes(section)) return;
  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
  $(section).classList.add("active");
  const h = $(section).querySelector("h1");
  if (h) document.title = h.textContent + " | Rural Health Referral";
}
document.querySelectorAll("[data-section]").forEach(b => b.addEventListener("click", () => show(b.dataset.section)));

/* Which of the three big screens is showing: "login", "register" or "app" */
function showScreen(name) {
  $("loginScreen").classList.toggle("hidden", name !== "login");
  $("registerScreen").classList.toggle("hidden", name !== "register");
  $("app").classList.toggle("hidden", name !== "app");
}

/* ---------- Current facility bar (shown on every page) ---------- */
function renderContextBar(u) {
  const f = facilityById(u.facilityId);
  $("contextBar").innerHTML = f
    ? `<span><b>Working at:</b> ${esc(f.name)} <span class="chip">${esc(levelLabel(f))}</span></span><span>Signed in as ${esc(u.fullName)} (${esc(u.role)})</span>`
    : `<span><b>${esc(u.role)}:</b> not linked to a single facility</span><span>Signed in as ${esc(u.fullName)}</span>`;
}

/* Show only the menu items and buttons that belong to this role (data-roles="worker,admin") */
function applyRole(user) {
  const code = Rules.ROLE_CODE[user.role];
  document.querySelectorAll("[data-roles]").forEach(el => {
    el.hidden = !el.dataset.roles.split(",").includes(code);
  });
}

async function enterApp(user) {
  currentUser = user;
  facilities = await Data.listFacilities();
  applyRole(user);
  showScreen("app");
  $("userName").textContent = user.fullName;
  $("userRole").textContent = user.role;
  renderContextBar(user);
  renderHospitals();
  await refresh();
  show("dashboard");
}

/* ---------- Sign in, register, sign out ---------- */
$("loginForm").addEventListener("submit", safe(async e => {
  e.preventDefault();
  let user;
  try { user = await Data.login($("username").value, $("password").value); }
  catch (err) { $("password").value = ""; throw err; }
  $("password").value = "";
  await enterApp(user);
}));

$("logout").onclick = safe(async () => {
  await Data.logout();
  currentUser = null;
  // Clear patient details from the screen so the next person on a shared device cannot see them
  $("assessmentForm").reset();
  $("assessmentResult").innerHTML = "";
  ["referralList", "trackingList", "incomingList", "offlineList", "feedbackList"].forEach(id => { $(id).innerHTML = ""; });
  $("summaryPatient").textContent = "No assessment";
  $("summaryUrgency").textContent = "—";
  $("summaryNeeds").textContent = "None recorded";
  showScreen("login");
  document.title = "Rural Health Referral System";
});

function fillRegisterFacilities() {
  $("regFacility").innerHTML = '<option value="">Select your facility</option>'
    + facilities.map(f => `<option value="${f.id}">${esc(f.name)} (Level ${f.level})</option>`).join("");
}
$("goRegister").onclick = () => showScreen("register");
$("goLogin").onclick = () => showScreen("login");

$("registerForm").addEventListener("submit", safe(async e => {
  e.preventDefault();
  const form = $("registerForm");
  const check = Validate.registrationForm({
    fullName: $("regFullName").value, username: $("regUsername").value, cadre: $("regCadre").value,
    licence: $("regLicence").value, phone: $("regPhone").value, facilityId: $("regFacility").value,
    password: $("regPassword").value, password2: $("regPassword2").value
  }, facilities);
  if (!check.valid) { showErrors(form, check.errors); return; }
  try {
    await Data.registerUser(check.clean);
  } catch (err) {
    if (err.field === "username") { showErrors(form, { regUsername: err.message }); return; }
    throw err;
  }
  clearErrors(form);
  form.reset();
  showScreen("login");
  $("username").value = check.clean.username;
  $("password").focus();
  notify("Account created. Please sign in.");
}));

/* ---------- Connection status (real + simulated for demonstrations) ---------- */
const isOffline = () => !navigator.onLine || ($("simulateOffline") && $("simulateOffline").checked);
function updateConnection() {
  const off = isOffline();
  $("connectionStatus").textContent = off ? "Offline: new referrals will be saved on this device" : "Online";
  const s = $("systemStatus");
  s.innerHTML = `<span aria-hidden="true">●</span> ${off ? "Offline mode" : "System Online"}`;
  s.classList.toggle("is-offline", off);
}
window.addEventListener("online", updateConnection);
window.addEventListener("offline", updateConnection);
$("simulateOffline").addEventListener("change", () => {
  updateConnection();
  notify(isOffline() ? "Offline mode on. New referrals will be saved on this device." : "Back online. You can synchronize pending referrals.");
});

/* ---------- Assessment result and human review ---------- */
function renderResult(a) {
  const info = Rules.URGENCY_INFO[a.aiUrgency];
  const reasonsHtml = a.reasons.length
    ? `<p><b>Why this recommendation:</b></p><ul>${a.reasons.map(r => `<li>${esc(r.text)}: ${r.pts} points</li>`).join("")}</ul>`
    : "<p>No symptoms were selected and no measurements were in the risk range.</p>";
  const missingHtml = a.missing.length
    ? `<p><b>Not measured:</b> ${a.missing.join(", ")}. This recommendation uses the available information only.</p>` : "";
  const canSpeak = ("speechSynthesis" in window) && typeof window.speakText === "function";
  const speech = `${a.aiUrgency} urgency recommendation. ${info.text} `
    + (a.reasons.length ? "Reasons: " + a.reasons.map(r => `${r.text}, ${r.pts} points`).join(". ") + ". " : "")
    + (a.missing.length ? "Not measured: " + a.missing.join(", ") + ". " : "")
    + "The healthcare worker must review and accept, modify or reject this recommendation.";

  $("assessmentResult").innerHTML = `<div class="result ${a.aiUrgency.toLowerCase()}">
  <h2 id="resultHeading" tabindex="-1">${a.aiUrgency} urgency recommendation</h2>
  <div class="urgency urgency--${a.aiUrgency.toLowerCase()}"><span aria-hidden="true">${info.icon}</span><span>${a.aiUrgency}: ${info.text}</span></div>
  <p>Prototype decision-support score: ${a.score}</p>
  ${reasonsHtml}
  ${missingHtml}
  <p>A LOW result does not rule out serious illness. Use your clinical judgement.</p>
  ${canSpeak ? `<p><button type="button" id="speakResult" class="secondary"><span aria-hidden="true">🔊</span> Read result aloud</button> <button type="button" id="stopSpeak" class="secondary">Stop</button></p>` : ""}
  <form id="reviewForm" novalidate>
   <fieldset>
    <legend>Healthcare worker review</legend>
    <p class="hint">You make the final decision. Choose one option.</p>
    <div class="options">
     <label><input type="radio" name="decision" value="accept" checked> Accept: ${a.aiUrgency} urgency</label>
     <label><input type="radio" name="decision" value="modify"> Modify: choose a different urgency level</label>
     <label><input type="radio" name="decision" value="reject"> Reject: do not use the recommendation</label>
    </div>
    <div id="overrideBox" hidden>
     <label for="finalUrgency">Your urgency level</label>
     <select id="finalUrgency"><option>HIGH</option><option>MEDIUM</option><option>LOW</option></select>
     <label for="reviewReason">Reason (required)</label>
     <textarea id="reviewReason" rows="3"></textarea>
    </div>
   </fieldset>
   <button type="submit">Save review and continue to referral</button>
  </form>
 </div>`;

  document.querySelectorAll('#reviewForm input[name="decision"]').forEach(r => r.addEventListener("change", () => {
    $("overrideBox").hidden = document.querySelector('#reviewForm input[name="decision"]:checked').value === "accept";
  }));
  if (canSpeak) {
    $("speakResult").onclick = () => window.speakText(speech, "en");
    $("stopSpeak").onclick = () => window.stopSpeaking && window.stopSpeaking();
  }
  $("reviewForm").addEventListener("submit", safe(async ev => {
    ev.preventDefault();
    const decision = document.querySelector('#reviewForm input[name="decision"]:checked').value;
    const reason = $("reviewReason").value.trim();
    let chosen = a.aiUrgency;
    const errors = {};
    if (decision !== "accept") {
      chosen = $("finalUrgency").value;
      const problem = Validate.reason(reason);
      if (problem) errors.reviewReason = problem;
      if (decision === "modify" && chosen === a.aiUrgency) errors.finalUrgency = "Choose a different urgency level, or select Accept.";
    }
    if (Object.keys(errors).length) { showErrors($("reviewForm"), errors); return; }
    clearErrors($("reviewForm"));
    await Data.reviewAssessment(a.id, { decision, reason, finalUrgency: chosen });
    await refresh();
    notify(`Review saved. Final urgency: ${chosen}.`);
    show("referrals");
  }));
  $("resultHeading").focus();
}

$("assessmentForm").addEventListener("submit", safe(async e => {
  e.preventDefault();
  const form = $("assessmentForm");

  // 1. Check the form (Validate returns messages per field, plus tidied values)
  const check = Validate.assessmentForm({
    patientId: $("patientId").value, age: $("age").value, sex: $("sex").value,
    temperature: $("temperature").value, heartRate: $("heartRate").value, oxygen: $("oxygen").value,
    needsOther: $("needsOther").value
  });
  let errors = check.errors;
  if (check.valid) {
    const conflict = Validate.patientConsistency(check.clean, await Data.listAssessments());
    if (conflict) errors = { patientId: conflict };
  }
  if (Object.keys(errors).length) { showErrors(form, errors); return; }
  clearErrors(form);
  $("patientId").value = check.clean.patientCode;   // show the tidied ID, e.g. "pat-001" becomes "PAT-001"

  // 2. Read symptoms and needs, then ask the rules for a recommendation
  const symptoms = [...document.querySelectorAll("#assessmentForm .checks input:checked")].map(x => x.value);
  const needs = [...document.querySelectorAll("#assessmentForm .options input:checked")].map(x => x.value);
  if (check.clean.needsOther) needs.push("Other: " + check.clean.needsOther);
  const result = Rules.assess({ symptoms, ...check.clean.vitals });

  // 3. Save it through the data layer (it adds who and where from the signed-in account)
  const assessment = await Data.createAssessment({
    patientCode: check.clean.patientCode,
    age: check.clean.age,
    sex: check.clean.sex,
    symptoms, needs, vitals: check.clean.vitals,
    aiUrgency: result.urgency, score: result.score, reasons: result.reasons, missing: result.missing
  });

  // 4. Update the screens
  await refresh();
  renderResult(assessment);
}));

/* ---------- Hospitals and referrals ---------- */
function renderHospitals() {
  const list = receivers();
  $("hospitalList").innerHTML = list.map(h => `<div class="hospital"><h3>${esc(h.name)}</h3><p><span aria-hidden="true">📍</span> <span class="sr-only">Location: </span>${esc(h.location)}</p><p>${esc(levelLabel(h))}</p><p><b>Services:</b> ${h.services.map(esc).join(", ")}</p></div>`).join("");
  $("hospitalSelect").innerHTML = '<option value="">Select hospital</option>' + list.map(h => `<option value="${h.id}">${esc(h.name)}</option>`).join("");
  updateServices();
}
$("hospitalSelect").onchange = updateServices;
function updateServices() {
  const h = receivers().find(x => String(x.id) === $("hospitalSelect").value);
  $("serviceSelect").innerHTML = h ? '<option value="">Select service</option>' + h.services.map(s => `<option>${esc(s)}</option>`).join("") : '<option value="">Select hospital first</option>';
}

$("createReferral").onclick = safe(async () => {
  const a = await Data.getLatestAssessment();
  if (!a) { notify("Assess a patient first.", "error"); return; }
  if (!a.review) { notify("Review the urgency recommendation on the Patient Assessment page first.", "error"); return; }
  const h = receivers().find(x => String(x.id) === $("hospitalSelect").value);
  const service = $("serviceSelect").value;
  if (!h) { notify("Select a referral hospital.", "error"); $("hospitalSelect").focus(); return; }
  if (!service) { notify("Select a service.", "error"); $("serviceSelect").focus(); return; }

  // Only the choices are sent. The server side (data.js) works out the urgency, patient and summary itself.
  const input = { assessmentId: a.id, hospitalId: h.id, service };
  const offline = isOffline();
  const r = offline ? await Data.queueReferral(input) : await Data.createReferral(input);
  await refresh();
  notify(offline ? `Referral ${r.code} saved on this device. It will be sent when you synchronize.` : `Referral ${r.code} created successfully.`);
});

$("syncOffline").onclick = safe(async () => {
  const pending = await Data.listOutbox();
  if (!pending.length) { notify("There are no pending offline referrals."); return; }
  if (isOffline()) { notify("Still offline. Connect to the internet and try again.", "error"); return; }
  const moved = await Data.syncOutbox();
  await refresh();
  notify(`${moved.length} pending referral${moved.length === 1 ? "" : "s"} synchronized.`);
});

$("feedbackForm").addEventListener("submit", safe(async e => {
  e.preventDefault();
  const problem = Validate.feedbackText($("feedback").value);
  if (problem) { showErrors($("feedbackForm"), { feedback: problem }); return; }
  clearErrors($("feedbackForm"));
  await Data.addFeedback({ role: $("testerRole").value, ease: $("ease").value, text: $("feedback").value });
  $("feedback").value = "";
  await refresh();
  notify("Feedback submitted. Thank you.");
}));

/* ---------- Refresh screens (asks Data for everything, then redraws) ---------- */
const needsLine = r => r.needs && r.needs.length ? `<p><b>Special needs:</b> ${esc(r.needs.join(", "))}</p>` : "";
const routeLine = r => `${esc(facilityName(r.fromFacilityId))} → ${esc(facilityName(r.hospitalId))}`;
const URGENCY_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 };

const historyHtml = r => (r.history && r.history.length)
  ? `<ol class="history">${r.history.map(h => `<li><b>${esc(h.status)}</b> <small>${esc(fmtDate(h.at))}${h.byName ? " · " + esc(h.byName) : ""}</small>${h.note ? `<br>${esc(h.note)}` : ""}</li>`).join("")}</ol>` : "";

function renderStats(st) {
  const rows = {
    worker: [["Patients Assessed", st.assessed], ["High Urgency", st.high], ["Referrals Created", st.referrals], ["Pending Offline", st.offline]],
    hospital: [["Incoming Referrals", st.incoming], ["High Urgency (open)", st.openHigh], ["Awaiting Response", st.awaiting], ["Completed", st.completed]],
    admin: [["Patients Assessed (all facilities)", st.assessed], ["High Urgency (all)", st.high], ["Referrals (all)", st.referrals], ["Referrals Completed", st.completed]]
  }[st.kind];
  const slots = [["patientLabel", "patientCount"], ["highLabel", "highCount"], ["referralLabel", "referralCount"], ["offlineLabel", "offlineCount"]];
  slots.forEach(([labelId, valueId], i) => { $(labelId).textContent = rows[i][0]; $(valueId).textContent = rows[i][1]; });
}

/* One incoming referral, written like a referral letter, with the actions the hospital may take */
function incomingCard(r) {
  const s = r.summary || {};
  const v = s.vitals || {};
  const measures = [
    v.temperature != null ? `Temperature ${v.temperature} °C` : null,
    v.heartRate != null ? `Heart rate ${v.heartRate} beats per minute` : null,
    v.oxygenSaturation != null ? `Oxygen saturation ${v.oxygenSaturation}%` : null
  ].filter(Boolean).join(", ") || "None recorded";
  const reasons = (s.reasons || []).map(x => `<li>${esc(x.text)}: ${x.pts} points</li>`).join("");
  const review = s.reviewDecision === "accept" ? "The healthcare worker accepted the recommendation."
    : s.reviewDecision ? `The healthcare worker changed the recommendation (${esc(s.reviewDecision)}): ${esc(s.reviewReason)}` : "";
  const actions = Rules.referralActions(r.status);
  const info = Rules.URGENCY_INFO[r.urgency] || { icon: "", text: "" };
  const form = actions.length
    ? `<form class="action-form" data-id="${esc(r.id)}" data-code="${esc(r.code)}" data-status="${esc(r.status)}" novalidate>
        <label for="act-${esc(r.code)}">Action</label>
        <select id="act-${esc(r.code)}"><option value="">Choose an action</option>${actions.map(a => `<option value="${a.id}">${esc(a.label)}</option>`).join("")}</select>
        <label for="note-${esc(r.code)}">Note (required when rejecting, otherwise optional)</label>
        <textarea id="note-${esc(r.code)}" rows="2"></textarea>
        <button type="submit">Update referral</button>
      </form>`
    : `<p class="hint">No further actions for this referral.${r.outcome ? " Outcome: " + esc(r.outcome) + "." : ""}</p>`;
  return `<article class="referral-item" id="card-${esc(r.code)}" tabindex="-1">
    <h2>${esc(r.code)} <span class="status">${esc(r.status)}</span></h2>
    <div class="urgency urgency--${esc(r.urgency.toLowerCase())}"><span aria-hidden="true">${info.icon}</span><span>${esc(r.urgency)} urgency</span></div>
    <p><b>From:</b> ${esc(facilityName(r.fromFacilityId))}<br><b>Service requested:</b> ${esc(r.service)}</p>
    <p><b>Patient:</b> ${esc(r.patientCode)}${s.age != null ? ", age " + esc(s.age) : ""}${s.sex ? ", " + esc(s.sex) : ""}</p>
    <p><b>Symptoms:</b> ${(s.symptoms || []).length ? esc(s.symptoms.join(", ")) : "None selected"}</p>
    <p><b>Measurements:</b> ${esc(measures)}</p>
    ${(s.missing || []).length ? `<p><b>Not measured:</b> ${esc(s.missing.join(", "))}</p>` : ""}
    ${reasons ? `<p><b>Why this urgency:</b></p><ul>${reasons}</ul>` : ""}
    ${review ? `<p>${review}</p>` : ""}
    ${needsLine(r)}
    <h3>History</h3>
    ${historyHtml(r)}
    ${form}
  </article>`;
}

function renderIncoming(referrals) {
  if (!referrals.length) { $("incomingList").innerHTML = "<div class='card'>No incoming referrals yet.</div>"; return; }
  // Open referrals first, then most urgent, then oldest
  const sorted = [...referrals].sort((a, b) =>
    (Rules.OPEN_STATUSES.includes(a.status) ? 0 : 1) - (Rules.OPEN_STATUSES.includes(b.status) ? 0 : 1)
    || (URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency])
    || String(a.createdAt).localeCompare(String(b.createdAt)));
  $("incomingList").innerHTML = sorted.map(incomingCard).join("");

  document.querySelectorAll("#incomingList .action-form").forEach(f => f.addEventListener("submit", safe(async ev => {
    ev.preventDefault();
    const { id, code, status } = f.dataset;
    const actionId = $("act-" + code).value;
    const note = $("note-" + code).value;
    const action = Rules.referralActions(status).find(a => a.id === actionId);
    const errors = {};
    if (!action) errors["act-" + code] = "Choose an action.";
    else if (action.noteRequired) { const problem = Validate.reason(note); if (problem) errors["note-" + code] = problem; }
    if (Object.keys(errors).length) { showErrors(f, errors); return; }
    clearErrors(f);
    await Data.updateReferralStatus(id, actionId, note);
    await refresh();
    notify(`${code}: ${action.toStatus}.`);
    const card = $("card-" + code);
    if (card) card.focus();
  })));
}

async function refresh() {
  const [stats, referrals, outbox, feedback, latest] = await Promise.all([
    Data.getStats(), Data.listReferrals(), Data.listOutbox(), Data.listFeedback(), Data.getLatestAssessment()
  ]);
  const code = currentUser ? Rules.ROLE_CODE[currentUser.role] : "";

  renderStats(stats);

  if (latest) {
    $("summaryPatient").textContent = latest.patientCode;
    $("summaryUrgency").textContent = finalUrgency(latest) + (latest.review ? (latest.review.decision === "accept" ? " (accepted)" : " (changed by healthcare worker)") : " (awaiting review)");
    $("summaryNeeds").textContent = latest.needs && latest.needs.length ? latest.needs.join(", ") : "None recorded";
  }

  const referralItem = r => `<div class="referral-item"><b>${esc(r.code)}</b><p>Patient: ${esc(r.patientCode)} | Urgency: ${esc(r.urgency)}</p><p>${routeLine(r)}</p><p>Service: ${esc(r.service)}</p>${needsLine(r)}<span class="status">${esc(r.status)}</span></div>`;
  $("referralList").innerHTML = referrals.length ? referrals.map(referralItem).join("") : "<div class='card'>No referrals created yet.</div>";

  $("trackingList").innerHTML = referrals.length
    ? referrals.map(r => `<div class="referral-item"><b>${esc(r.code)}</b><p>${esc(r.patientCode)}: ${routeLine(r)}</p><span class="status">${esc(r.status)}</span>${r.outcome ? `<p><b>Outcome:</b> ${esc(r.outcome)}</p>` : ""}${historyHtml(r)}</div>`).join("")
    : "<div class='card'>No Referral to Track. Create a referral first.</div>";

  if (code === "hospital") renderIncoming(referrals);

  $("offlineList").innerHTML = outbox.length
    ? outbox.map(r => `<div class="offline-item"><b>${esc(r.code)}</b> — ${esc(r.patientCode)}: ${routeLine(r)} (${esc(r.urgency)})${needsLine(r)}</div>`).join("")
    : "<div class='card'>No Pending Offline Referrals. Referrals saved while offline will appear here.</div>";

  $("feedbackList").innerHTML = code === "admin"
    ? feedback.map(f => `<div class="feedback-item"><b>${esc(f.role)}</b> — ${esc(f.ease)}<p>${esc(f.text)}</p><small>${esc(fmtDate(f.createdAt))}</small></div>`).join("") || "<div class='card'>No feedback yet.</div>"
    : "<p class='hint'>Your feedback goes to the project administrators.</p>";
}

/* ---------- Start up ---------- */
(async function init() {
  try {
    facilities = await Data.listFacilities();
    fillRegisterFacilities();
    const user = await Data.getCurrentUser();   // still signed in after a page refresh?
    if (user) await enterApp(user); else showScreen("login");
  } catch (err) {
    console.error(err);
    notify("The app could not load its data. Please refresh the page.", "error");
  }
  updateConnection();
})();
