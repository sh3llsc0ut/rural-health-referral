/* script.js
   SCREENS AND EVENTS ONLY.
   - It never touches localStorage directly: it asks Data (data.js).
   - It holds no urgency rules: it asks Rules (rules.js).
   Because Data functions are async, we use "await" before them. */

const $ = id => document.getElementById(id);

/* Escape anything typed by users before putting it into HTML */
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* Dates are stored as ISO strings; format them only when showing them */
const fmtDate = iso => { if (!iso) return ""; const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString(); };

let hospitals = [];
const hospitalName = id => { const h = hospitals.find(x => String(x.id) === String(id)); return h ? h.name : "Unknown hospital"; };
const finalUrgency = a => (a.review ? a.review.finalUrgency : a.aiUrgency);
const readNumber = id => { const v = $(id).value.trim(); return v === "" ? null : Number(v); };

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

/* ---------- Navigation ---------- */
function show(section) {
  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
  $(section).classList.add("active");
  const h = $(section).querySelector("h1");
  if (h) document.title = h.textContent + " | Rural Health Referral";
}
document.querySelectorAll("[data-section]").forEach(b => b.addEventListener("click", () => show(b.dataset.section)));

$("loginForm").addEventListener("submit", safe(async e => {
  e.preventDefault();
  const name = $("username").value.trim() || "User";
  await Data.setCurrentUser({ username: name, role: $("role").value });
  $("loginScreen").classList.add("hidden");
  $("app").classList.remove("hidden");
  $("userName").textContent = name;
  await refresh();
}));

$("logout").onclick = safe(async () => {
  await Data.setCurrentUser(null);
  $("app").classList.add("hidden");
  $("loginScreen").classList.remove("hidden");
  document.title = "Rural Health Referral System";
});

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
  <form id="reviewForm">
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
    if (decision !== "accept") {
      chosen = $("finalUrgency").value;
      if (!reason) { notify("Please give a reason for changing the recommendation.", "error"); $("reviewReason").focus(); return; }
      if (decision === "modify" && chosen === a.aiUrgency) { notify("Choose a different urgency level, or select Accept.", "error"); $("finalUrgency").focus(); return; }
    }
    await Data.reviewAssessment(a.id, { decision, reason, finalUrgency: chosen });
    await refresh();
    notify(`Review saved. Final urgency: ${chosen}.`);
    show("referrals");
  }));
  $("resultHeading").focus();
}

$("assessmentForm").addEventListener("submit", safe(async e => {
  e.preventDefault();
  // 1. Read the form
  const symptoms = [...document.querySelectorAll("#assessmentForm .checks input:checked")].map(x => x.value);
  const needs = [...document.querySelectorAll("#assessmentForm .options input:checked")].map(x => x.value);
  const other = $("needsOther").value.trim();
  if (other) needs.push("Other: " + other);
  const vitals = { temperature: readNumber("temperature"), heartRate: readNumber("heartRate"), oxygenSaturation: readNumber("oxygen") };

  // 2. Ask the rules for a recommendation
  const result = Rules.assess({ symptoms, ...vitals });

  // 3. Save it through the data layer
  const assessment = await Data.createAssessment({
    patientCode: $("patientId").value.trim(),
    age: Number($("age").value),
    sex: $("sex").value,
    symptoms, needs, vitals,
    aiUrgency: result.urgency, score: result.score, reasons: result.reasons, missing: result.missing
  });

  // 4. Update the screens
  await refresh();
  renderResult(assessment);
}));

/* ---------- Hospitals and referrals ---------- */
function renderHospitals() {
  $("hospitalList").innerHTML = hospitals.map(h => `<div class="hospital"><h3>${esc(h.name)}</h3><p><span aria-hidden="true">📍</span> <span class="sr-only">Location: </span>${esc(h.location)}</p><p><b>Services:</b> ${h.services.map(esc).join(", ")}</p></div>`).join("");
  $("hospitalSelect").innerHTML = '<option value="">Select hospital</option>' + hospitals.map(h => `<option value="${h.id}">${esc(h.name)}</option>`).join("");
  updateServices();
}
$("hospitalSelect").onchange = updateServices;
function updateServices() {
  const h = hospitals.find(x => String(x.id) === $("hospitalSelect").value);
  $("serviceSelect").innerHTML = h ? '<option value="">Select service</option>' + h.services.map(s => `<option>${esc(s)}</option>`).join("") : '<option value="">Select hospital first</option>';
}

$("createReferral").onclick = safe(async () => {
  const a = await Data.getLatestAssessment();
  if (!a) { notify("Assess a patient first.", "error"); return; }
  if (!a.review) { notify("Review the urgency recommendation on the Patient Assessment page first.", "error"); return; }
  const h = hospitals.find(x => String(x.id) === $("hospitalSelect").value);
  const service = $("serviceSelect").value;
  if (!h) { notify("Select a referral hospital.", "error"); $("hospitalSelect").focus(); return; }
  if (!service) { notify("Select a service.", "error"); $("serviceSelect").focus(); return; }

  const input = {
    patientCode: a.patientCode, assessmentId: a.id,
    urgency: finalUrgency(a), aiUrgency: a.aiUrgency,
    needs: a.needs || [], hospitalId: h.id, service
  };
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
  await Data.addFeedback({ role: $("testerRole").value, ease: $("ease").value, text: $("feedback").value });
  $("feedback").value = "";
  await refresh();
  notify("Feedback submitted. Thank you.");
}));

/* ---------- Refresh screens (asks Data for everything, then redraws) ---------- */
const needsLine = r => r.needs && r.needs.length ? `<p><b>Special needs:</b> ${esc(r.needs.join(", "))}</p>` : "";

async function refresh() {
  const [assessments, referrals, outbox, feedback, latest] = await Promise.all([
    Data.listAssessments(), Data.listReferrals(), Data.listOutbox(), Data.listFeedback(), Data.getLatestAssessment()
  ]);

  $("patientCount").textContent = assessments.length;
  $("highCount").textContent = assessments.filter(a => finalUrgency(a) === "HIGH").length;
  $("referralCount").textContent = referrals.length;
  $("offlineCount").textContent = outbox.length;

  if (latest) {
    $("summaryPatient").textContent = latest.patientCode;
    $("summaryUrgency").textContent = finalUrgency(latest) + (latest.review ? (latest.review.decision === "accept" ? " (accepted)" : " (changed by healthcare worker)") : " (awaiting review)");
    $("summaryNeeds").textContent = latest.needs && latest.needs.length ? latest.needs.join(", ") : "None recorded";
  }

  $("referralList").innerHTML = referrals.length
    ? referrals.map(r => `<div class="referral-item"><b>${esc(r.code)}</b><p>Patient: ${esc(r.patientCode)} | Urgency: ${esc(r.urgency)}</p><p>${esc(hospitalName(r.hospitalId))} — ${esc(r.service)}</p>${needsLine(r)}<span class="status">${esc(r.status)}</span></div>`).join("")
    : "<div class='card'>No referrals created yet.</div>";

  $("trackingList").innerHTML = referrals.length
    ? referrals.map(r => `<div class="referral-item"><b>${esc(r.code)}</b><p>${esc(r.patientCode)} → ${esc(hospitalName(r.hospitalId))}</p><span class="status">${esc(r.status)}</span></div>`).join("")
    : "<div class='card'>No Referral to Track. Create a referral first.</div>";

  $("offlineList").innerHTML = outbox.length
    ? outbox.map(r => `<div class="offline-item"><b>${esc(r.code)}</b> — ${esc(r.patientCode)} → ${esc(hospitalName(r.hospitalId))} (${esc(r.urgency)})${needsLine(r)}</div>`).join("")
    : "<div class='card'>No Pending Offline Referrals. Referrals saved while offline will appear here.</div>";

  $("feedbackList").innerHTML = feedback.map(f => `<div class="feedback-item"><b>${esc(f.role)}</b> — ${esc(f.ease)}<p>${esc(f.text)}</p><small>${esc(fmtDate(f.createdAt))}</small></div>`).join("");
}

/* ---------- Start up ---------- */
(async function init() {
  try {
    hospitals = await Data.listHospitals();
    renderHospitals();
    await refresh();
  } catch (err) {
    console.error(err);
    notify("The app could not load its data. Please refresh the page.", "error");
  }
  updateConnection();
})();
