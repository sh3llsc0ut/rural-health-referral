/* validation.js
   THE VALIDATION RULES. Pure functions, like rules.js: no page, no storage.

   They are used in TWO places:
   1. script.js, before saving, to show friendly messages next to each field.
   2. data.js, as a second check when saving. Later the Django backend will
      repeat the same rules. A browser can always be bypassed (anyone can edit
      the JavaScript or call the API directly), so the server must never
      trust the browser. Frontend checks give quick feedback; backend checks
      protect the data. */
const Validate = (() => {
  // Change the patient ID format here and it changes everywhere.
  const PATIENT_ID = {
    pattern: /^PAT-\d{3,6}$/,
    hint: "Use the format PAT- followed by 3 to 6 digits, for example PAT-001."
  };
  const SEX_OPTIONS = ["Female", "Male", "Other"];
  const URGENCY_LEVELS = ["HIGH", "MEDIUM", "LOW"];
  const DECISIONS = ["accept", "modify", "reject"];
  const LIMITS = {
    age: { min: 0, max: 120 },
    temperature: { min: 30, max: 45 },
    heartRate: { min: 20, max: 250 },
    oxygenSaturation: { min: 50, max: 100 },
    needsOther: 200,
    reason: { min: 5, max: 500 },
    feedback: { min: 5, max: 1000 }
  };

  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const text = v => String(v == null ? "" : v).trim();

  // "  pat-001 " becomes "PAT-001"
  const normalizePatientId = raw => String(raw == null ? "" : raw).replace(/\s+/g, "").toUpperCase();

  /* Read a number typed in a text box. Returns { value, error }.
     An empty optional field gives value null ("not measured"), never 0. */
  function number(raw, o) {
    const t = text(raw);
    if (t === "") return o.required ? { value: null, error: `Enter the ${o.label}.` } : { value: null, error: null };
    const n = Number(t);
    if (!isFinite(n)) return { value: null, error: `${cap(o.label)} must be a number.` };
    if (o.integer && !Number.isInteger(n)) return { value: null, error: `${cap(o.label)} must be a whole number.` };
    if (n < o.min || n > o.max) return { value: null, error: `${cap(o.label)} must be between ${o.min} and ${o.max}.` };
    return { value: n, error: null };
  }

  /* Checks the assessment form. Returns { valid, errors: {fieldId: message}, clean }.
     "clean" holds the tidied values to save. */
  function assessmentForm(v) {
    const errors = {};
    const clean = {};

    const id = normalizePatientId(v.patientId);
    if (!id) errors.patientId = "Enter the patient ID.";
    else if (!PATIENT_ID.pattern.test(id)) errors.patientId = PATIENT_ID.hint;
    else clean.patientCode = id;

    const age = number(v.age, { label: "age", min: LIMITS.age.min, max: LIMITS.age.max, integer: true, required: true });
    if (age.error) errors.age = age.error; else clean.age = age.value;

    if (!SEX_OPTIONS.includes(v.sex)) errors.sex = "Choose the sex from the list."; else clean.sex = v.sex;

    const t = number(v.temperature, { label: "temperature", min: LIMITS.temperature.min, max: LIMITS.temperature.max });
    const h = number(v.heartRate, { label: "heart rate", min: LIMITS.heartRate.min, max: LIMITS.heartRate.max, integer: true });
    const o = number(v.oxygen, { label: "oxygen saturation", min: LIMITS.oxygenSaturation.min, max: LIMITS.oxygenSaturation.max, integer: true });
    if (t.error) errors.temperature = t.error;
    if (h.error) errors.heartRate = h.error;
    if (o.error) errors.oxygen = o.error;
    clean.vitals = { temperature: t.value, heartRate: h.value, oxygenSaturation: o.value };

    const other = text(v.needsOther);
    if (other.length > LIMITS.needsOther) errors.needsOther = `Keep this under ${LIMITS.needsOther} characters (it is ${other.length}).`;
    else clean.needsOther = other;

    return { valid: Object.keys(errors).length === 0, errors, clean };
  }

  /* Is this the same patient as before? A patient ID may appear in many
     assessments (return visits), but the details should not contradict
     earlier ones. This only sees records on THIS device. True uniqueness
     across all users and facilities needs the backend database. */
  function patientConsistency(candidate, previous) {
    const last = [...previous].reverse().find(a => a.patientCode === candidate.patientCode);
    if (!last) return null;
    if (last.sex !== candidate.sex) return `${candidate.patientCode} was recorded earlier as ${last.sex}. Check the patient ID or the sex.`;
    if (candidate.age < last.age - 1) return `${candidate.patientCode} was recorded earlier at age ${last.age}. Check the patient ID or the age.`;
    return null;
  }

  /* Reason for changing a recommendation */
  function reason(raw) {
    const t = text(raw);
    if (t.length < LIMITS.reason.min) return `Give a reason of at least ${LIMITS.reason.min} characters.`;
    if (t.length > LIMITS.reason.max) return `Keep the reason under ${LIMITS.reason.max} characters.`;
    return null;
  }

  function feedbackText(raw) {
    const t = text(raw);
    if (t.length < LIMITS.feedback.min) return `Write at least ${LIMITS.feedback.min} characters of feedback.`;
    if (t.length > LIMITS.feedback.max) return `Keep feedback under ${LIMITS.feedback.max} characters.`;
    return null;
  }

  /* ---------- Registration ---------- */
  const CADRES = ["Community Health Worker", "Nurse", "Clinical Officer", "Doctor", "Other health worker"];
  const PASSWORD_HINT = "Use at least 8 characters, with at least one letter and one number.";
  const normalizeUsername = raw => text(raw).toLowerCase();

  // 0712345678, 0112345678, 254712345678 and +254712345678 all become +254712345678
  function normalizePhone(raw) {
    const t = String(raw == null ? "" : raw).replace(/[\s-]/g, "");
    const m = t.match(/^(?:\+?254|0)([17]\d{8})$/);
    return m ? "+254" + m[1] : null;
  }

  function passwordProblem(pw, username) {
    if (typeof pw !== "string" || pw.length < 8) return PASSWORD_HINT;
    if (pw.length > 100) return "Use at most 100 characters.";
    if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return PASSWORD_HINT;
    if (username && pw.toLowerCase() === username) return "The password must not be the same as the username.";
    return null;
  }

  /* Checks the registration form. Errors are keyed by element id, like assessmentForm. */
  function registrationForm(v, facilities) {
    const errors = {};
    const clean = {};

    const fullName = text(v.fullName).replace(/\s+/g, " ");
    if (!/^\p{L}[\p{L}\s.'-]{1,79}$/u.test(fullName)) errors.regFullName = "Enter your full name (2 to 80 letters).";
    else clean.fullName = fullName;

    const username = normalizeUsername(v.username);
    if (!/^[a-z0-9._]{3,30}$/.test(username)) errors.regUsername = "Use 3 to 30 characters: lowercase letters, numbers, dots or underscores.";
    else clean.username = username;

    if (!CADRES.includes(v.cadre)) errors.regCadre = "Choose your profession from the list.";
    else clean.cadre = v.cadre;

    const licence = text(v.licence);
    if (licence && !/^[A-Za-z0-9\/-]{3,20}$/.test(licence)) errors.regLicence = "Use 3 to 20 letters, numbers, dashes or slashes, or leave it empty.";
    else clean.licence = licence;

    const phone = normalizePhone(v.phone);
    if (!text(v.phone)) errors.regPhone = "Enter your mobile phone number.";
    else if (!phone) errors.regPhone = "Enter a Kenyan mobile number, for example 0712 345 678.";
    else clean.phone = phone;

    const fid = facilities.find(f => String(f.id) === String(v.facilityId));
    if (!fid) errors.regFacility = "Choose the facility where you work.";
    else clean.facilityId = fid.id;

    const pwProblem = passwordProblem(v.password, clean.username);
    if (pwProblem) errors.regPassword = pwProblem;
    else clean.password = v.password;
    if (!errors.regPassword && v.password !== v.password2) errors.regPassword2 = "The two passwords do not match.";

    return { valid: Object.keys(errors).length === 0, errors, clean };
  }

  // Server-style check: same rules again, returns the first problem or null
  function registrationRecord(rec, facilities) {
    const r = registrationForm({
      fullName: rec.fullName, username: rec.username, cadre: rec.cadre, licence: rec.licence,
      phone: rec.phone, facilityId: rec.facilityId, password: rec.password, password2: rec.password
    }, facilities);
    return Object.values(r.errors)[0] || null;
  }

  /* ---------- "Server-style" checks used by data.js ----------
     Each returns an error message, or null when everything is fine. */
  function assessmentRecord(rec) {
    if (!PATIENT_ID.pattern.test(rec.patientCode || "")) return "Invalid patient ID. " + PATIENT_ID.hint;
    if (!Number.isInteger(rec.age) || rec.age < LIMITS.age.min || rec.age > LIMITS.age.max) return "Invalid age.";
    if (!SEX_OPTIONS.includes(rec.sex)) return "Invalid sex.";
    const v = rec.vitals || {};
    for (const key of ["temperature", "heartRate", "oxygenSaturation"]) {
      const x = v[key];
      if (x !== null && x !== undefined && (typeof x !== "number" || x < LIMITS[key].min || x > LIMITS[key].max)) return `Invalid ${key}.`;
    }
    if (!URGENCY_LEVELS.includes(rec.aiUrgency)) return "Invalid urgency level.";
    return null;
  }

  function reviewRecord(review) {
    if (!DECISIONS.includes(review.decision)) return "Invalid review decision.";
    if (!URGENCY_LEVELS.includes(review.finalUrgency)) return "Invalid urgency level.";
    if (review.decision !== "accept") return reason(review.reason);
    return null;
  }

  function referralRecord(rec, facilities) {
    if (!PATIENT_ID.pattern.test(rec.patientCode || "")) return "Invalid patient ID.";
    if (!URGENCY_LEVELS.includes(rec.urgency)) return "Invalid urgency level.";
    if (!facilities.some(f => String(f.id) === String(rec.fromFacilityId))) return "Your account is not linked to a facility, so it cannot create referrals.";
    const h = facilities.find(x => String(x.id) === String(rec.hospitalId));
    if (!h) return "The selected hospital does not exist.";
    if (!h.receivesReferrals) return "That facility does not receive referrals.";
    if (String(h.id) === String(rec.fromFacilityId)) return "A patient cannot be referred to the facility where they are already being treated.";
    if (!h.services.includes(rec.service)) return "That hospital does not offer the selected service.";
    return null;
  }

  return {
    PATIENT_ID, LIMITS, SEX_OPTIONS, URGENCY_LEVELS, CADRES, PASSWORD_HINT,
    normalizePatientId, normalizeUsername, normalizePhone,
    assessmentForm, registrationForm, patientConsistency, reason, feedbackText,
    assessmentRecord, reviewRecord, referralRecord, registrationRecord
  };
})();
