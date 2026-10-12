/* data.js
   THE DATA LAYER. This is the only file allowed to touch localStorage.
   The rest of the app calls functions like Data.createReferral(...) and never
   cares WHERE the data is kept.

   Every function is "async" (returns a Promise) even though localStorage is
   instant. Why? Because the real backend will be a network call, and network
   calls take time. If the screens already use "await" now, then later we only
   rewrite the inside of these functions to use fetch() and the screens do
   not change at all.

   Records are plain objects shaped like the future database tables
   (see DATA-MODEL.md). Dates are ISO strings (e.g. 2026-10-08T14:30:00.000Z),
   which databases understand; the screens format them for display. */
const Data = (() => {
  const STORAGE_KEY = "rhrData_v2";

  const emptyDb = () => ({
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
        ["assessments", "referrals", "outbox", "feedback"].forEach(k => {
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

  /* ---------- current user (kept in memory only; real login comes with the backend) ---------- */
  let currentUser = null;
  async function setCurrentUser(user) { currentUser = user ? { ...user } : null; return copy(currentUser); }
  async function getCurrentUser() { return currentUser ? copy(currentUser) : null; }

  /* ---------- hospitals (read-only seed data for now) ---------- */
  async function listHospitals() { return copy(HOSPITAL_SEED); }

  /* ---------- assessments ---------- */
  async function listAssessments() { return copy(db.assessments); }

  async function getLatestAssessment() {
    const a = db.assessments[db.assessments.length - 1];
    return a ? copy(a) : null;
  }

  async function createAssessment(input) {
    const a = { id: newId(), createdAt: now(), review: null, ...input };
    db.assessments.push(a);
    persist();
    return copy(a);
  }

  async function reviewAssessment(id, review) {
    const a = db.assessments.find(x => x.id === id);
    if (!a) throw new Error("Assessment not found.");
    a.review = {
      decision: review.decision,          // "accept" | "modify" | "reject"
      reason: review.reason || "",
      finalUrgency: review.finalUrgency,  // "HIGH" | "MEDIUM" | "LOW"
      reviewedAt: now()
    };
    persist();
    return copy(a);
  }

  /* ---------- referrals ---------- */
  async function listReferrals() { return copy(db.referrals); }

  async function createReferral(input) {
    const r = { id: newId(), code: nextReferralCode(), status: "Created", createdAt: now(), ...input };
    db.referrals.push(r);
    persist();
    return copy(r);
  }

  /* ---------- offline "outbox" ----------
     When there is no connection, a referral is saved in the outbox instead.
     Later, syncOutbox() will send each queued item to the server
     (POST /api/referrals/) and remove it from the outbox once it succeeds. */
  async function listOutbox() { return copy(db.outbox); }

  async function queueReferral(input) {
    const r = {
      id: newId(), code: nextReferralCode(), status: "Saved offline (pending sync)",
      createdAt: now(), ...input
    };
    db.outbox.push(r);
    persist();
    return copy(r);
  }

  async function syncOutbox() {
    const moved = db.outbox.map(r => ({ ...r, status: "Created", syncedAt: now() }));
    db.referrals.push(...moved);
    db.outbox = [];
    persist();
    return copy(moved);
  }

  /* ---------- feedback ---------- */
  async function listFeedback() { return copy(db.feedback); }

  async function addFeedback(input) {
    const f = { id: newId(), createdAt: now(), ...input };
    db.feedback.push(f);
    persist();
    return copy(f);
  }

  /* ---------- development helper: Data.clearAll() in the browser console ---------- */
  async function clearAll() { db = emptyDb(); persist(); }

  return {
    setCurrentUser, getCurrentUser,
    listHospitals,
    listAssessments, getLatestAssessment, createAssessment, reviewAssessment,
    listReferrals, createReferral,
    listOutbox, queueReferral, syncOutbox,
    listFeedback, addFeedback,
    clearAll
  };
})();
