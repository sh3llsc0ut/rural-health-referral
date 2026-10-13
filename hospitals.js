/* hospitals.js
   DEMONSTRATION DATA ONLY. These are mock facilities for the academic prototype.
   Names, levels and services are made up for demonstration and do not
   describe the real facilities. Later this list will live in the database and
   the frontend will fetch it from the backend (for example: GET /api/facilities/).
   Only data.js reads this array directly.

   level: Kenya's health system levels (2 = dispensary ... 6 = national referral).
   receivesReferrals: true if other facilities may refer patients here. */
const FACILITY_LEVELS = {
  2: "Dispensary",
  3: "Health Centre",
  4: "Sub-County Hospital",
  5: "County Referral Hospital",
  6: "National Referral Hospital"
};

const FACILITY_SEED = [
  { id: 1, name: "Migori County Referral Hospital", location: "Migori", level: 5, receivesReferrals: true, services: ["Emergency", "General Medicine", "Surgery", "Maternity"] },
  { id: 2, name: "Kisii Teaching and Referral Hospital", location: "Kisii", level: 5, receivesReferrals: true, services: ["Emergency", "Specialist Care", "Surgery", "Maternity"] },
  { id: 3, name: "Kenyatta National Hospital", location: "Nairobi", level: 6, receivesReferrals: true, services: ["Emergency", "Specialist Care", "Surgery", "ICU"] },
  { id: 4, name: "Rongo Sub-County Hospital", location: "Rongo", level: 4, receivesReferrals: true, services: ["Emergency", "General Medicine", "Maternity"] },
  { id: 5, name: "Awendo Sub-County Hospital", location: "Awendo", level: 4, receivesReferrals: true, services: ["Emergency", "General Medicine", "Maternity"] },
  { id: 6, name: "Uriri Health Centre", location: "Uriri", level: 3, receivesReferrals: false, services: ["Outpatient", "Maternity"] },
  { id: 7, name: "Kehancha Dispensary", location: "Kehancha", level: 2, receivesReferrals: false, services: ["Outpatient"] }
];
