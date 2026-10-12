/* hospitals.js
   DEMONSTRATION DATA ONLY. These are mock hospitals for the academic prototype.
   Later, this list will live in the database and the frontend will fetch it
   from the backend (for example: GET /api/hospitals/). Nothing else in the
   project reads this array directly: only data.js does. */
const HOSPITAL_SEED = [
  { id: 1, name: "Migori County Referral Hospital", location: "Migori", services: ["Emergency", "General Medicine", "Surgery", "Maternity"] },
  { id: 2, name: "Kisii Teaching and Referral Hospital", location: "Kisii", services: ["Emergency", "Specialist Care", "Surgery", "Maternity"] },
  { id: 3, name: "Kenyatta National Hospital", location: "Nairobi", services: ["Emergency", "Specialist Care", "Surgery", "ICU"] }
];
