/* a11y.js — include with: <script src="a11y.js" defer></script> */
(function () {
  "use strict";
  var root = document.documentElement;

  function save(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  /* ---------- Preferences: text size + contrast ---------- */
  var sizes = ["normal", "large", "xlarge"];
  var prefs = {
    font: load("a11y-font") || "normal",
    contrast: load("a11y-contrast") || "normal"
  };
  function applyPrefs() {
    root.setAttribute("data-font", prefs.font);
    root.setAttribute("data-contrast", prefs.contrast);
  }
  applyPrefs();

  /* ---------- Live region for announcements ---------- */
  var live = document.createElement("div");
  live.id = "a11y-live";
  live.className = "sr-only";
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");

  window.announce = function (msg) {
    live.textContent = "";
    setTimeout(function () { live.textContent = msg; }, 50);
  };

  /* ---------- Move focus to the new page heading ----------
     Call this from your navigation function after showing a section:
       a11yFocusHeading(document.getElementById("assessment-page"));  */
  window.a11yFocusHeading = function (container) {
    if (!container) return;
    var h = container.querySelector("h1, h2");
    if (!h) return;
    h.setAttribute("tabindex", "-1");
    h.focus();
  };

  /* ---------- Read aloud (Web Speech API) ---------- */
  window.speakText = function (text, lang) {
    if (!("speechSynthesis" in window)) return false;
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = lang || "en-KE"; // use "sw-KE" for Swahili if the device has a voice
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
    return true;
  };
  window.stopSpeaking = function () {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  };

  /* ---------- Accessible urgency result ----------
     Usage: container.innerHTML = renderUrgency("HIGH", ["SpO2 88% (<92%)", "Difficulty breathing"]); */
  window.renderUrgency = function (level, reasons) {
    var key = String(level).toLowerCase();
    var icons = { high: "▲", medium: "◆", low: "●" };
    var words = {
      high: "HIGH urgency: urgent referral should be considered",
      medium: "MEDIUM urgency: further assessment and possible referral",
      low: "LOW urgency: routine assessment and follow-up"
    };
    var list = (reasons || []).map(function (r) {
      return "<li>" + String(r).replace(/</g, "&lt;") + "</li>";
    }).join("");
    return (
      '<div class="urgency urgency--' + key + '" role="status">' +
        '<span aria-hidden="true">' + (icons[key] || "") + "</span>" +
        "<span>" + (words[key] || level) + "</span>" +
      "</div>" +
      (list ? "<p>Reasons for this recommendation:</p><ul>" + list + "</ul>" : "")
    );
  };

  /* ---------- Toolbar ---------- */
  function buildToolbar() {
    var bar = document.createElement("div");
    bar.id = "a11y-toolbar";
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "Accessibility options");

    var sizeBtn = document.createElement("button");
    sizeBtn.type = "button";
    function sizeLabel() {
      sizeBtn.textContent = "Text size: " + prefs.font;
      sizeBtn.setAttribute("aria-label", "Change text size. Current: " + prefs.font);
    }
    sizeLabel();
    sizeBtn.addEventListener("click", function () {
      prefs.font = sizes[(sizes.indexOf(prefs.font) + 1) % sizes.length];
      save("a11y-font", prefs.font);
      applyPrefs(); sizeLabel();
      window.announce("Text size " + prefs.font);
    });

    var conBtn = document.createElement("button");
    conBtn.type = "button";
    conBtn.textContent = "High contrast";
    conBtn.setAttribute("aria-pressed", prefs.contrast === "high");
    conBtn.addEventListener("click", function () {
      prefs.contrast = prefs.contrast === "high" ? "normal" : "high";
      save("a11y-contrast", prefs.contrast);
      applyPrefs();
      conBtn.setAttribute("aria-pressed", prefs.contrast === "high");
      window.announce("High contrast " + (prefs.contrast === "high" ? "on" : "off"));
    });

    bar.appendChild(sizeBtn);
    bar.appendChild(conBtn);
    document.body.appendChild(bar);
  }

  /* ---------- Watch your existing navigation (no changes to script.js needed) ---------- */
  function watchNavigation() {
    var app = document.getElementById("app");
    var login = document.getElementById("loginScreen");
    var sections = document.querySelectorAll(".section");
    var navButtons = document.querySelectorAll(".sidebar nav button[data-section]");

    function syncNav(id) {
      navButtons.forEach(function (b) {
        if (b.getAttribute("data-section") === id) b.setAttribute("aria-current", "page");
        else b.removeAttribute("aria-current");
      });
    }
    function hadClass(oldValue, cls) {
      return (oldValue || "").split(/\s+/).indexOf(cls) !== -1;
    }

    var initial = document.querySelector(".section.active");
    if (initial) syncNav(initial.id);

    // A section gains "active": update menu state and move focus to its heading
    var sectionObs = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        var el = m.target;
        if (el.classList.contains("active") && !hadClass(m.oldValue, "active")) {
          syncNav(el.id);
          if (app && !app.classList.contains("hidden")) window.a11yFocusHeading(el);
        }
      });
    });
    sections.forEach(function (s) {
      sectionObs.observe(s, { attributes: true, attributeFilter: ["class"], attributeOldValue: true });
    });

    // After login: focus the dashboard heading
    if (app) {
      new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
          if (hadClass(m.oldValue, "hidden") && !app.classList.contains("hidden")) {
            var active = document.querySelector(".section.active");
            if (active) { syncNav(active.id); window.a11yFocusHeading(active); }
          }
        });
      }).observe(app, { attributes: true, attributeFilter: ["class"], attributeOldValue: true });
    }

    // After logout: focus the login heading
    if (login) {
      new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
          if (hadClass(m.oldValue, "hidden") && !login.classList.contains("hidden")) {
            window.a11yFocusHeading(login);
          }
        });
      }).observe(login, { attributes: true, attributeFilter: ["class"], attributeOldValue: true });
    }

    // When an assessment result appears, bring it into view
    var result = document.getElementById("assessmentResult");
    if (result) {
      new MutationObserver(function () {
        if (result.children.length) result.scrollIntoView({ block: "nearest" });
      }).observe(result, { childList: true });
    }
  }

  /* ---------- Tell users when connectivity changes ---------- */
  function watchConnection() {
    window.addEventListener("offline", function () {
      window.announce("You are offline. Referrals will be saved on this device.");
    });
    window.addEventListener("online", function () {
      window.announce("Connection restored. You can synchronize pending referrals.");
    });
  }

  function init() {
    document.body.appendChild(live);
    buildToolbar();
    watchNavigation();
    watchConnection();

    // Mark decorative emoji/icons as hidden from screen readers
    document.querySelectorAll(".icon, [data-icon]").forEach(function (el) {
      el.setAttribute("aria-hidden", "true");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
