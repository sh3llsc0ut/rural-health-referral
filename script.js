const hospitals=[
 {id:1,name:"Migori County Referral Hospital",location:"Migori",services:["Emergency","General Medicine","Surgery","Maternity"]},
 {id:2,name:"Kisii Teaching and Referral Hospital",location:"Kisii",services:["Emergency","Specialist Care","Surgery","Maternity"]},
 {id:3,name:"Kenyatta National Hospital",location:"Nairobi",services:["Emergency","Specialist Care","Surgery","ICU"]}
];

/* ---------- State (safe if browser storage is blocked or corrupted) ---------- */
let state=null;
try{state=JSON.parse(localStorage.getItem("rhrState")||"null");}catch(e){state=null;}
if(!state||typeof state!=="object")state={};
["patients","referrals","offline","feedback"].forEach(k=>{if(!Array.isArray(state[k]))state[k]=[];});
if(!("lastAssessment" in state))state.lastAssessment=null;
const save=()=>{try{localStorage.setItem("rhrState",JSON.stringify(state));}catch(e){}};
const $=id=>document.getElementById(id);

/* Escape anything typed by users before putting it into HTML */
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

/* ---------- Accessible messages (replaces alert()) ---------- */
function notify(msg,type){
 const box=$("toast");
 if(!box)return;
 box.setAttribute("aria-live",type==="error"?"assertive":"polite");
 box.className="toast"+(type==="error"?" error":"");
 box.innerHTML=`<span>${esc(msg)}</span><button type="button" id="toastClose" aria-label="Dismiss message">✕</button>`;
 $("toastClose").onclick=()=>{box.innerHTML="";box.className="toast";};
}

/* ---------- Navigation ---------- */
function show(section){
 document.querySelectorAll(".section").forEach(s=>s.classList.remove("active"));
 $(section).classList.add("active");
 const h=$(section).querySelector("h1");
 if(h)document.title=h.textContent+" | Rural Health Referral";
}
document.querySelectorAll("[data-section]").forEach(b=>b.addEventListener("click",()=>show(b.dataset.section)));

$("loginForm").addEventListener("submit",e=>{
 e.preventDefault();
 $("loginScreen").classList.add("hidden"); $("app").classList.remove("hidden");
 $("userName").textContent=$("username").value||"User";
 refresh();
});
$("logout").onclick=()=>{ $("app").classList.add("hidden"); $("loginScreen").classList.remove("hidden"); document.title="Rural Health Referral System"; };

/* ---------- Connection status (real + simulated for demonstrations) ---------- */
const isOffline=()=>!navigator.onLine||($("simulateOffline")&&$("simulateOffline").checked);
function updateConnection(){
 const off=isOffline();
 $("connectionStatus").textContent=off?"Offline: new referrals will be saved on this device":"Online";
 const s=$("systemStatus");
 s.innerHTML=`<span aria-hidden="true">●</span> ${off?"Offline mode":"System Online"}`;
 s.classList.toggle("is-offline",off);
}
window.addEventListener("online",updateConnection);
window.addEventListener("offline",updateConnection);
$("simulateOffline").addEventListener("change",()=>{
 updateConnection();
 notify(isOffline()?"Offline mode on. New referrals will be saved on this device.":"Back online. You can synchronize pending referrals.");
});

/* ---------- Assessment (same scoring rules, now with reasons) ---------- */
function assess(){
 const symptoms=[...document.querySelectorAll("#assessmentForm .checks input:checked")].map(x=>x.value);
 const num=id=>{const v=$(id).value.trim();return v===""?null:Number(v);};
 const temp=num("temperature"), hr=num("heartRate"), oxy=num("oxygen");
 let score=0; const reasons=[];
 const add=(pts,text)=>{score+=pts;reasons.push({text,pts});};
 const symptomPoints={"Difficulty breathing":4,"Chest pain":4,"High fever":2,"Severe headache":2,"Severe abdominal pain":2};
 symptoms.forEach(s=>{if(symptomPoints[s])add(symptomPoints[s],s);});
 if(temp!==null&&temp>=39)add(2,`Temperature ${temp} °C (39 or above)`);
 if(hr!==null&&(hr>=120||hr<=50))add(2,`Heart rate ${hr} beats per minute (120 or above, or 50 or below)`);
 if(oxy!==null&&oxy>0&&oxy<92)add(5,`Oxygen saturation ${oxy}% (below 92%)`);
 else if(oxy!==null&&oxy>0&&oxy<95)add(2,`Oxygen saturation ${oxy}% (92 to 94%)`);
 const missing=[];
 if(temp===null)missing.push("temperature");
 if(hr===null)missing.push("heart rate");
 if(oxy===null)missing.push("oxygen saturation");
 const urgency=score>=5?"HIGH":score>=2?"MEDIUM":"LOW";
 return {urgency,score,symptoms,temp,hr,oxy,reasons,missing};
}

const URG={
 HIGH:{icon:"▲",text:"Urgent referral should be considered."},
 MEDIUM:{icon:"◆",text:"Further assessment and possible referral."},
 LOW:{icon:"●",text:"Routine assessment and follow-up."}
};

function renderResult(p){
 const reasonsHtml=p.reasons.length
  ?`<p><b>Why this recommendation:</b></p><ul>${p.reasons.map(r=>`<li>${esc(r.text)}: ${r.pts} points</li>`).join("")}</ul>`
  :"<p>No symptoms were selected and no measurements were in the risk range.</p>";
 const missingHtml=p.missing.length
  ?`<p><b>Not measured:</b> ${p.missing.join(", ")}. This recommendation uses the available information only.</p>`:"";
 const canSpeak=("speechSynthesis" in window)&&typeof window.speakText==="function";
 const speech=`${p.urgency} urgency recommendation. ${URG[p.urgency].text} `
  +(p.reasons.length?"Reasons: "+p.reasons.map(r=>`${r.text}, ${r.pts} points`).join(". ")+". ":"")
  +(p.missing.length?"Not measured: "+p.missing.join(", ")+". ":"")
  +"The healthcare worker must review and accept, modify or reject this recommendation.";

 $("assessmentResult").innerHTML=`<div class="result ${p.urgency.toLowerCase()}">
  <h2 id="resultHeading" tabindex="-1">${p.urgency} urgency recommendation</h2>
  <div class="urgency urgency--${p.urgency.toLowerCase()}"><span aria-hidden="true">${URG[p.urgency].icon}</span><span>${p.urgency}: ${URG[p.urgency].text}</span></div>
  <p>Prototype decision-support score: ${p.score}</p>
  ${reasonsHtml}
  ${missingHtml}
  <p>A LOW result does not rule out serious illness. Use your clinical judgement.</p>
  ${canSpeak?`<p><button type="button" id="speakResult" class="secondary"><span aria-hidden="true">🔊</span> Read result aloud</button> <button type="button" id="stopSpeak" class="secondary">Stop</button></p>`:""}
  <form id="reviewForm">
   <fieldset>
    <legend>Healthcare worker review</legend>
    <p class="hint">You make the final decision. Choose one option.</p>
    <div class="options">
     <label><input type="radio" name="decision" value="accept" checked> Accept: ${p.urgency} urgency</label>
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

 document.querySelectorAll('#reviewForm input[name="decision"]').forEach(r=>r.addEventListener("change",()=>{
  $("overrideBox").hidden=document.querySelector('#reviewForm input[name="decision"]:checked').value==="accept";
 }));
 if(canSpeak){
  $("speakResult").onclick=()=>window.speakText(speech,"en");
  $("stopSpeak").onclick=()=>window.stopSpeaking&&window.stopSpeaking();
 }
 $("reviewForm").addEventListener("submit",ev=>{
  ev.preventDefault();
  const decision=document.querySelector('#reviewForm input[name="decision"]:checked').value;
  const reason=$("reviewReason").value.trim();
  let finalUrgency=p.urgency;
  if(decision!=="accept"){
   finalUrgency=$("finalUrgency").value;
   if(!reason){notify("Please give a reason for changing the recommendation.","error");$("reviewReason").focus();return;}
   if(decision==="modify"&&finalUrgency===p.urgency){notify("Choose a different urgency level, or select Accept.","error");$("finalUrgency").focus();return;}
  }
  applyReview(p.uid,{decision,reason,finalUrgency});
 });
 $("resultHeading").focus();
}

function applyReview(uid,review){
 const stamp=new Date().toLocaleString();
 [state.lastAssessment,...state.patients].filter(x=>x&&x.uid===uid).forEach(t=>{
  t.review={decision:review.decision,reason:review.reason,date:stamp};
  t.finalUrgency=review.finalUrgency;
 });
 save(); refresh();
 notify(`Review saved. Final urgency: ${review.finalUrgency}.`);
 show("referrals");
}

$("assessmentForm").addEventListener("submit",e=>{
 e.preventDefault();
 const needs=[...document.querySelectorAll("#assessmentForm .options input:checked")].map(x=>x.value);
 const other=$("needsOther").value.trim();
 if(other)needs.push("Other: "+other);
 const a=assess(), patient={uid:Date.now(),id:$("patientId").value,age:$("age").value,sex:$("sex").value,needs,...a,date:new Date().toLocaleString()};
 state.lastAssessment=patient;
 state.patients.push(patient); save(); refresh();
 renderResult(patient);
});

/* ---------- Hospitals and referrals ---------- */
function renderHospitals(){
 $("hospitalList").innerHTML=hospitals.map(h=>`<div class="hospital"><h3>${esc(h.name)}</h3><p><span aria-hidden="true">📍</span> <span class="sr-only">Location: </span>${esc(h.location)}</p><p><b>Services:</b> ${h.services.map(esc).join(", ")}</p></div>`).join("");
 $("hospitalSelect").innerHTML='<option value="">Select hospital</option>'+hospitals.map(h=>`<option value="${h.id}">${esc(h.name)}</option>`).join("");
 updateServices();
}
$("hospitalSelect").onchange=updateServices;
function updateServices(){
 const h=hospitals.find(x=>x.id==$("hospitalSelect").value);
 $("serviceSelect").innerHTML=h?'<option value="">Select service</option>'+h.services.map(s=>`<option>${esc(s)}</option>`).join(""):'<option value="">Select hospital first</option>';
}

$("createReferral").onclick=()=>{
 const a=state.lastAssessment;
 if(!a){notify("Assess a patient first.","error");return;}
 if(!a.review){notify("Review the urgency recommendation on the Patient Assessment page first.","error");return;}
 const h=hospitals.find(x=>x.id==$("hospitalSelect").value), service=$("serviceSelect").value;
 if(!h){notify("Select a referral hospital.","error");$("hospitalSelect").focus();return;}
 if(!service){notify("Select a service.","error");$("serviceSelect").focus();return;}
 const offline=isOffline();
 const r={id:"REF-"+Date.now().toString().slice(-6),patient:a.id,urgency:a.finalUrgency||a.urgency,aiUrgency:a.urgency,needs:a.needs||[],hospital:h.name,service,status:offline?"Saved offline (pending sync)":"Created",date:new Date().toLocaleString()};
 (offline?state.offline:state.referrals).push(r);
 save(); refresh();
 notify(offline?`Referral ${r.id} saved on this device. It will be sent when you synchronize.`:`Referral ${r.id} created successfully.`);
};

$("syncOffline").onclick=()=>{
 if(!state.offline.length){notify("There are no pending offline referrals.");return;}
 if(isOffline()){notify("Still offline. Connect to the internet and try again.","error");return;}
 const n=state.offline.length;
 state.offline.forEach(r=>{r.status="Created";state.referrals.push(r);});
 state.offline=[]; save(); refresh();
 notify(`${n} pending referral${n===1?"":"s"} synchronized.`);
};

$("feedbackForm").addEventListener("submit",e=>{
 e.preventDefault();
 state.feedback.push({role:$("testerRole").value,ease:$("ease").value,text:$("feedback").value,date:new Date().toLocaleString()});
 $("feedback").value=""; save(); refresh(); notify("Feedback submitted. Thank you.");
});

/* ---------- Refresh screens ---------- */
const needsLine=r=>r.needs&&r.needs.length?`<p><b>Special needs:</b> ${esc(r.needs.join(", "))}</p>`:"";

function refresh(){
 $("patientCount").textContent=state.patients.length;
 $("highCount").textContent=state.patients.filter(p=>(p.finalUrgency||p.urgency)==="HIGH").length;
 $("referralCount").textContent=state.referrals.length;
 $("offlineCount").textContent=state.offline.length;
 const a=state.lastAssessment;
 if(a){
  $("summaryPatient").textContent=a.id;
  $("summaryUrgency").textContent=(a.finalUrgency||a.urgency)+(a.review?(a.review.decision==="accept"?" (accepted)":" (changed by healthcare worker)"):" (awaiting review)");
  $("summaryNeeds").textContent=a.needs&&a.needs.length?a.needs.join(", "):"None recorded";
 }
 $("referralList").innerHTML=state.referrals.length?state.referrals.map(r=>`<div class="referral-item"><b>${esc(r.id)}</b><p>Patient: ${esc(r.patient)} | Urgency: ${esc(r.urgency)}</p><p>${esc(r.hospital)} — ${esc(r.service)}</p>${needsLine(r)}<span class="status">${esc(r.status)}</span></div>`).join(""):"<div class='card'>No referrals created yet.</div>";
 $("trackingList").innerHTML=state.referrals.length?state.referrals.map(r=>`<div class="referral-item"><b>${esc(r.id)}</b><p>${esc(r.patient)} → ${esc(r.hospital)}</p><span class="status">${esc(r.status)}</span></div>`).join(""):"<div class='card'>No Referral to Track. Create a referral first.</div>";
 $("offlineList").innerHTML=state.offline.length?state.offline.map(r=>`<div class="offline-item"><b>${esc(r.id)}</b> — ${esc(r.patient)} → ${esc(r.hospital)} (${esc(r.urgency)})${needsLine(r)}</div>`).join(""):"<div class='card'>No Pending Offline Referrals. Referrals saved while offline will appear here.</div>";
 $("feedbackList").innerHTML=state.feedback.map(f=>`<div class="feedback-item"><b>${esc(f.role)}</b> — ${esc(f.ease)}<p>${esc(f.text)}</p><small>${esc(f.date)}</small></div>`).join("");
}
renderHospitals(); refresh(); updateConnection();
