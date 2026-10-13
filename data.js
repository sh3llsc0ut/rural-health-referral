/* data.js
   THE DATA LAYER. This is the only file allowed to touch localStorage.
   The rest of the app calls functions like Data.createReferral(...) and never
   cares WHERE the data is kept.

   Every function is "async" (returns a Promise) so that later, when the data
   lives on a Django server, only the inside of these functions changes
   (to fetch() calls) and the screens stay the same.

   This file also plays the role of the SERVER for now:
   - it checks every record again with Validate (never trust the browser),
   - it decides WHO is acting (from the signed-in session, not from the form),
   - it decides roles (self-registration can only make a Healthcare Worker),
   - it decides who may see or change what (role and facility checks),
   - it stores passwords only as salted hashes, never as plain text.
   Real security is only possible with the backend: anyone can read this
   browser's storage. */
const Data = (() => {
  const STORAGE_KEY = "rhrData_v2";
  const SESSION_KEY = "rhrSession";   // sessionStorage: ends when the tab is closed

  const emptyDb = () => ({
    users: [],
    assessments: [],
    referrals: [],
    outbox: [],      // referrals saved while offline, waiting to be sent
    feedback: [],
    counters: { referral: 0 }
  });

  /* ---------- loading and saving ---------- */
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (raw && typeof raw === "object") {
        const base = emptyDb();
        const db = { ...base, ...raw, counters: { ...base.counters, ...(raw.counters || {}) } };
        ["users", "assessments", "referrals", "outbox", "feedback"].forEach(k => {
          if (!Array.isArray(db[k])) db[k] = [];
        });
        return db;
      }
    } catch (e) { /* corrupted or blocked storage: start empty */ }
    return emptyDb();
  }

  let db = load();

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch (e) {
      // Do not fail silently: the screens catch this and tell the user.
      throw new Error("Could not save data on this device. Storage may be full or blocked.");
    }
  }

  /* ---------- small helpers ---------- */
  const now = () => new Date().toISOString();

  // Stop with a readable error message when a check finds a problem.
  function check(problem) { if (problem) throw new Error(problem); }

  // Return copies, like a real API would. Screens can never change stored data by accident.
  const copy = x => JSON.parse(JSON.stringify(x));

  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  // Sequential, readable codes (REF-000001). The backend database will do this itself later.
  function nextReferralCode() {
    db.counters.referral += 1;
    return "REF-" + String(db.counters.referral).padStart(6, "0");
  }

  /* ---------- passwords: salted hash (PBKDF2), never plain text ---------- */
  const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  const fromHex = hex => new Uint8Array(hex.match(/.{2}/g).map(h => parseInt(h, 16)));

  async function hashPassword(password, saltHex) {
    const subtle = window.crypto && window.crypto.subtle;
    if (!subtle) throw new Error("Accounts need a secure page. Open the website address (https) instead of the file.");
    const salt = saltHex ? fromHex(saltHex) : window.crypto.getRandomValues(new Uint8Array(16));
    const key = await subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
    return { salt: toHex(salt), hash: toHex(bits) };
  }

  function sameText(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  // A user record without its password fields
  const publicUser = u => { const { passwordSalt, passwordHash, ...rest } = u; return copy(rest); };

  /* ---------- session: who is signed in ---------- */
  function sessionGet() { try { return sessionStorage.getItem(SESSION_KEY); } catch (e) { return null; } }
  function sessionSet(id) {
    try { if (id) sessionStorage.setItem(SESSION_KEY, id); else sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  }
  function currentUserRecord() {
    const id = sessionGet();
    return id ? (db.users.find(u => u.id === id) || null) : null;
  }
  function requireUser() {
    const u = currentUserRecord();
    if (!u) throw new Error("Please sign in first.");
    return u;
  }

  function requireRole(u, role, message) {
    if (u.role !== role) throw new Error(message || "Your role is not allowed to do this.");
  }

  /* ---------- who can see what (the server decides, never the screen) ---------- */
  const sameFacility = (a, b) => a != null && b != null && String(a) === String(b);
  const urgencyOf = a => (a.review ? a.review.finalUrgency : a.aiUrgency);

  // Healthcare workers: records from their own facility. Others: no patient records.
  const visibleAssessments = u => u.role === "Healthcare Worker" ? db.assessments.filter(a => sameFacility(a.facilityId, u.facilityId)) : [];
  // Workers see what their facility sent, hospital staff see what was sent to them, administrators see all.
  function visibleReferrals(u) {
    if (u.role === "Administrator") return db.referrals;
    if (u.role === "Referral Hospital") return db.referrals.filter(r => sameFacility(r.hospitalId, u.facilityId));
    return db.referrals.filter(r => sameFacility(r.fromFacilityId, u.facilityId));
  }
  const visibleOutbox = u => u.role === "Healthcare Worker" ? db.outbox.filter(r => sameFacility(r.fromFacilityId, u.facilityId)) : [];

  /* ---------- demo accounts (created once, on first visit) ---------- */
  const DEMO_PASSWORD = "Demo@1234";
  async function seedDemoUsers() {
    if (db.users.length) return;
    const demos = [
      { fullName: "Demo Health Worker", username: "demo.worker", role: "Healthcare Worker", cadre: "Nurse", facilityId: 4 },
      { fullName: "Demo Hospital Staff", username: "demo.hospital", role: "Referral Hospital", cadre: "Doctor", facilityId: 1 },
      { fullName: "Demo Administrator", username: "demo.admin", role: "Administrator", cadre: "Other health worker", facilityId: null }
    ];
    for (const d of demos) {
      const { salt, hash } = await hashPassword(DEMO_PASSWORD);
      db.users.push({
        id: newId(), createdAt: now(), licence: "", phone: "+254700000000", demo: true,
        ...d, passwordSalt: salt, passwordHash: hash
      });
    }
    persist();
  }
  let ready = seedDemoUsers().catch(e => { console.warn("Demo accounts were not created:", e.message); });

  /* ---------- accounts ---------- */
  async function registerUser(input) {
    await ready;
    check(Validate.registrationRecord(input, FACILITY_SEED));
    const username = Validate.normalizeUsername(input.username);
    if (db.users.some(u => u.username === username)) {
      // On a real server this check covers every user, not just this browser.
      const err = new Error("That username is already taken. Choose another.");
      err.field = "username";
      throw err;
    }
    const { salt, hash } = await hashPassword(input.password);
    const u = {
      id: newId(), createdAt: now(),
      fullName: input.fullName.trim(), username,
      role: "Healthcare Worker",           // decided here, never taken from the form
      cadre: input.cadre, licence: input.licence || "",
      phone: Validate.normalizePhone(input.phone),
      facilityId: Number(input.facilityId),
      passwordSalt: salt, passwordHash: hash
    };
    db.users.push(u);
    persist();
    return publicUser(u);
  }

  async function login(username, password) {
    await ready;
    const u = db.users.find(x => x.username === Validate.normalizeUsername(username));
    // Same message whether the username or the password is wrong, so it does not reveal which accounts exist.
    const fail = () => new Error("Incorrect username or password.");
    if (!u) throw fail();
    const { hash } = await hashPassword(String(password || ""), u.passwordSalt);
    if (!sameText(hash, u.passwordHash)) throw fail();
    sessionSet(u.id);
    return publicUser(u);
  }

  async function logout() { sessionSet(null); }
  async function getCurrentUser() { const u = currentUserRecord(); return u ? publicUser(u) : null; }

  /* ---------- facilities (read-only seed data for now) ---------- */
  async function listFacilities() { return copy(FACILITY_SEED); }
  async function listHospitals() { return copy(FACILITY_SEED.filter(f => f.receivesReferrals)); }

  /* ---------- assessments ---------- */
  async function listAssessments() { return copy(visibleAssessments(requireUser())); }

  async function getLatestAssessment() {
    const list = visibleAssessments(requireUser());
    const a = list[list.length - 1];
    return a ? copy(a) : null;
  }

  async function createAssessment(input) {
    const u = requireUser();
    requireRole(u, "Healthcare Worker", "Only healthcare workers can record patients.");
    check(u.facilityId == null ? "Your account is not linked to a facility, so it cannot record patients." : null);
    // Who and where come from the signed-in account, not from the form.
    const rec = { ...input, facilityId: u.facilityId, createdBy: u.id };
    check(Validate.assessmentRecord(rec) || Validate.patientConsistency(rec, db.assessments));
    const a = { id: newId(), createdAt: now(), review: null, ...rec };
    db.assessments.push(a);
    persist();
    return copy(a);
  }

  async function reviewAssessment(id, review) {
    const u = requireUser();
    requireRole(u, "Healthcare Worker", "Only healthcare workers can review recommendations.");
    const a = db.assessments.find(x => x.id === id);
    if (!a) throw new Error("Assessment not found.");
    check(sameFacility(a.facilityId, u.facilityId) ? null : "You can only review patients assessed at your facility.");
    check(Validate.reviewRecord(review));
    a.review = {
      decision: review.decision,          // "accept" | "modify" | "reject"
      reason: review.reason || "",
      finalUrgency: review.finalUrgency,  // "HIGH" | "MEDIUM" | "LOW"
      reviewedBy: u.id,
      reviewedAt: now()
    };
    persist();
    return copy(a);
  }

  /* ---------- referrals ---------- */
  async function listReferrals() { return copy(visibleReferrals(requireUser())); }

  // Builds a referral from a reviewed assessment. The server (this file) decides the
  // urgency, patient, needs and clinical summary; the form only chooses hospital and service.
  function buildReferral(u, input) {
    requireRole(u, "Healthcare Worker", "Only healthcare workers can create referrals.");
    const a = db.assessments.find(x => x.id === input.assessmentId);
    check(a ? null : "Assessment not found.");
    check(sameFacility(a.facilityId, u.facilityId) ? null : "You can only refer patients assessed at your facility.");
    check(a.review ? null : "Review the urgency recommendation before creating a referral.");
    const rec = {
      assessmentId: a.id, patientCode: a.patientCode,
      urgency: a.review.finalUrgency, aiUrgency: a.aiUrgency,
      needs: a.needs || [],
      // A snapshot, like a referral letter: the hospital sees what the worker saw.
      summary: {
        age: a.age, sex: a.sex, symptoms: a.symptoms, vitals: a.vitals, reasons: a.reasons, missing: a.missing,
        reviewDecision: a.review.decision, reviewReason: a.review.reason
      },
      hospitalId: input.hospitalId, service: input.service,
      fromFacilityId: u.facilityId, createdBy: u.id
    };
    check(Validate.referralRecord(rec, FACILITY_SEED));
    return rec;
  }

  const historyEntry = (u, status, note) => ({ status, at: now(), by: u.id, byName: u.fullName, note: note || "" });

  async function createReferral(input) {
    const u = requireUser();
    const rec = buildReferral(u, input);
    const r = { id: newId(), code: nextReferralCode(), status: "Created", createdAt: now(), history: [historyEntry(u, "Created")], ...rec };
    db.referrals.push(r);
    persist();
    return copy(r);
  }

  /* The receiving hospital moves a referral along its life cycle (see Rules.REFERRAL_FLOW). */
  async function updateReferralStatus(id, actionId, note) {
    const u = requireUser();
    requireRole(u, "Referral Hospital", "Only the receiving hospital can update a referral.");
    const r = db.referrals.find(x => x.id === id);
    if (!r) throw new Error("Referral not found.");
    check(sameFacility(r.hospitalId, u.facilityId) ? null : "This referral was sent to a different facility.");
    const action = Rules.referralActions(r.status).find(a => a.id === actionId);
    check(action ? null : `That action is not available for a referral that is ${r.status}.`);
    const text = String(note || "").trim();
    if (action.noteRequired) check(Validate.reason(text));
    check(text.length > Validate.LIMITS.reason.max ? "Keep the note under " + Validate.LIMITS.reason.max + " characters." : null);
    r.status = action.toStatus;
    if (action.outcome) r.outcome = action.outcome;
    r.history = [...(r.history || []), historyEntry(u, action.toStatus, text || action.outcome || "")];
    persist();
    return copy(r);
  }

  /* ---------- offline "outbox" ----------
     When there is no connection, a referral is saved in the outbox instead.
     Later, syncOutbox() will send each queued item to the server
     (POST /api/referrals/) and remove it from the outbox once it succeeds. */
  async function listOutbox() { return copy(visibleOutbox(requireUser())); }

  async function queueReferral(input) {
    const u = requireUser();
    const rec = buildReferral(u, input);
    const r = {
      id: newId(), code: nextReferralCode(), status: "Saved offline (pending sync)", createdAt: now(),
      history: [historyEntry(u, "Saved offline (pending sync)")], ...rec
    };
    db.outbox.push(r);
    persist();
    return copy(r);
  }

  async function syncOutbox() {
    const u = requireUser();
    requireRole(u, "Healthcare Worker", "Only healthcare workers can synchronize referrals.");
    const mine = visibleOutbox(u);
    const moved = mine.map(r => ({
      ...r, status: "Created", syncedAt: now(),
      history: [...(r.history || []), historyEntry(u, "Created", "Synchronized")]
    }));
    db.referrals.push(...moved);
    db.outbox = db.outbox.filter(r => !mine.includes(r));
    persist();
    return copy(moved);
  }

  /* ---------- dashboard numbers (computed here so administrators get totals, not patient records) ---------- */
  async function getStats() {
    const u = requireUser();
    if (u.role === "Healthcare Worker") {
      const as = visibleAssessments(u);
      return { kind: "worker", assessed: as.length, high: as.filter(a => urgencyOf(a) === "HIGH").length,
               referrals: visibleReferrals(u).length, offline: visibleOutbox(u).length };
    }
    if (u.role === "Referral Hospital") {
      const rs = visibleReferrals(u);
      return { kind: "hospital", incoming: rs.length,
               openHigh: rs.filter(r => Rules.OPEN_STATUSES.includes(r.status) && r.urgency === "HIGH").length,
               awaiting: rs.filter(r => r.status === "Created").length,
               completed: rs.filter(r => r.status === "Completed").length };
    }
    return { kind: "admin", assessed: db.assessments.length,
             high: db.assessments.filter(a => urgencyOf(a) === "HIGH").length,
             referrals: db.referrals.length, completed: db.referrals.filter(r => r.status === "Completed").length };
  }

  /* ---------- feedback ---------- */
  // Anyone can send feedback; only administrators can read it.
  async function listFeedback() {
    const u = requireUser();
    return u.role === "Administrator" ? copy(db.feedback) : [];
  }

  async function addFeedback(input) {
    const u = requireUser();
    check(Validate.feedbackText(input.text));
    const f = { id: newId(), createdAt: now(), userId: u.id, ...input };
    db.feedback.push(f);
    persist();
    return copy(f);
  }

  /* ---------- development helper: Data.clearAll() in the browser console ---------- */
  async function clearAll() {
    db = emptyDb();
    sessionSet(null);
    persist();
    ready = seedDemoUsers().catch(e => { console.warn("Demo accounts were not created:", e.message); });
    await ready;
  }

  return {
    registerUser, login, logout, getCurrentUser,
    listFacilities, listHospitals,
    listAssessments, getLatestAssessment, createAssessment, reviewAssessment,
    listReferrals, createReferral, updateReferralStatus,
    listOutbox, queueReferral, syncOutbox,
    getStats,
    listFeedback, addFeedback,
    clearAll
  };
})();
