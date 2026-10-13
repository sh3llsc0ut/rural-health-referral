/* rules.js
   THE BUSINESS RULES: urgency scoring, the referral status workflow, and which
   screens each role may use. These are "pure functions" / plain data: the same inputs always give
   the same output, and they never touch the page (no document, no $) or
   storage. That makes them easy to test and easy to move to the backend later.

   PROTOTYPE NOTICE: these rules are simulated decision support for academic
   demonstration. They are not clinically validated. */
const Rules = (() => {
  const SYMPTOM_POINTS = {
    "Difficulty breathing": 4,
    "Chest pain": 4,
    "High fever": 2,
    "Severe headache": 2,
    "Severe abdominal pain": 2
  };

  const URGENCY_INFO = {
    HIGH: { icon: "▲", text: "Urgent referral should be considered." },
    MEDIUM: { icon: "◆", text: "Further assessment and possible referral." },
    LOW: { icon: "●", text: "Routine assessment and follow-up." }
  };

  /* Which screens each role may open. The menu hides the others, and data.js
     refuses the matching actions even if someone edits the page. */
  const ROLE_CODE = { "Healthcare Worker": "worker", "Referral Hospital": "hospital", "Administrator": "admin" };
  const ROLE_SECTIONS = {
    "Healthcare Worker": ["dashboard", "assessment", "hospitals", "referrals", "tracking", "offline", "testing"],
    "Referral Hospital": ["dashboard", "incoming", "testing"],
    "Administrator": ["dashboard", "tracking", "testing"]
  };

  /* The referral life cycle. Each status lists the actions a receiving hospital
     may take next. A status with no actions is the end of the road. */
  const REFERRAL_FLOW = {
    "Created": [
      { id: "accept", label: "Accept referral", toStatus: "Accepted" },
      { id: "reject", label: "Reject referral", toStatus: "Rejected", noteRequired: true }
    ],
    "Accepted": [
      { id: "arrived", label: "Patient has arrived", toStatus: "Patient arrived" },
      { id: "no-show", label: "Patient did not arrive", toStatus: "Did not arrive" }
    ],
    "Patient arrived": [
      { id: "done-discharged", label: "Complete: treated and discharged", toStatus: "Completed", outcome: "Treated and discharged" },
      { id: "done-admitted", label: "Complete: admitted", toStatus: "Completed", outcome: "Admitted" },
      { id: "done-onward", label: "Complete: referred to another facility", toStatus: "Completed", outcome: "Referred onward" }
    ]
  };
  const OPEN_STATUSES = ["Created", "Accepted", "Patient arrived"];
  const referralActions = status => (REFERRAL_FLOW[status] || []).map(a => ({ ...a }));

  // A measurement is either a real number or null ("not measured").
  const asNumber = v => (typeof v === "number" && isFinite(v)) ? v : null;

  /* input:  { symptoms: ["Chest pain", ...], temperature, heartRate, oxygenSaturation }
     output: { urgency, score, reasons: [{text, pts}], missing: ["heart rate", ...] } */
  function assess(input) {
    const symptoms = Array.isArray(input.symptoms) ? input.symptoms : [];
    const temperature = asNumber(input.temperature);
    const heartRate = asNumber(input.heartRate);
    const oxygen = asNumber(input.oxygenSaturation);

    let score = 0;
    const reasons = [];
    const add = (pts, text) => { score += pts; reasons.push({ text, pts }); };

    symptoms.forEach(s => { if (SYMPTOM_POINTS[s]) add(SYMPTOM_POINTS[s], s); });

    if (temperature !== null && temperature >= 39) {
      add(2, `Temperature ${temperature} °C (39 or above)`);
    }
    if (heartRate !== null && (heartRate >= 120 || heartRate <= 50)) {
      add(2, `Heart rate ${heartRate} beats per minute (120 or above, or 50 or below)`);
    }
    if (oxygen !== null && oxygen > 0 && oxygen < 92) {
      add(5, `Oxygen saturation ${oxygen}% (below 92%)`);
    } else if (oxygen !== null && oxygen > 0 && oxygen < 95) {
      add(2, `Oxygen saturation ${oxygen}% (92 to 94%)`);
    }

    const missing = [];
    if (temperature === null) missing.push("temperature");
    if (heartRate === null) missing.push("heart rate");
    if (oxygen === null) missing.push("oxygen saturation");

    const urgency = score >= 5 ? "HIGH" : score >= 2 ? "MEDIUM" : "LOW";
    return { urgency, score, reasons, missing };
  }

  return { assess, SYMPTOM_POINTS, URGENCY_INFO, ROLE_CODE, ROLE_SECTIONS, REFERRAL_FLOW, OPEN_STATUSES, referralActions };
})();
