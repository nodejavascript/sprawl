/* The cookie gate — sprawl.nodejavascript.com
 *
 * 🔴 THE ANALYTICS TAG IS NOT IN THE DOCUMENT. This file holds the measurement id (read from its
 * own `data-ga-id`) and creates the tag only after a yes, so a visitor who refuses makes NO
 * request to Google at all.
 *
 * There is one real choice on this site: analytics. The game needs nothing stored to run, so
 * nothing else is offered. The choice is remembered in localStorage, and the door in the footer
 * goes through a DELEGATED listener on the document, because a listener bound at load dies the
 * moment the footer is re-rendered.
 */
(function () {
  var me = document.currentScript || document.querySelector("script[data-ga-id]");
  var GA_ID = (me && me.getAttribute("data-ga-id")) || "";
  var KEY = "sprawl.consent";
  var OUT = "ga_opt_out";
  var choice = null;

  try {
    /* 🔴 THE OWNER'S OWN SWITCH — ?ga=off / ?ga=on — deliberately NOT in the cookie panel: the
     * panel asks the visitor ONE real question and offers nothing else. */
    var q = String((window.location && window.location.search) || "");
    if (/[?&]ga=off\b/.test(q)) {
      localStorage.setItem(KEY, "denied");
      localStorage.setItem(OUT, "1");
    } else if (/[?&]ga=on\b/.test(q)) {
      localStorage.removeItem(OUT);
      localStorage.setItem(KEY, "granted");
    }
    choice = localStorage.getItem(OUT) === "1" ? "denied" : localStorage.getItem(KEY);
  } catch (e) {
    choice = null; /* private mode, or storage refused */
  }

  function loadTag() {
    if (!GA_ID || GA_ID.indexOf("X") !== -1) return;
    if (window.__sprawlTagLoaded) return;
    window.__sprawlTagLoaded = true;
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GA_ID);
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      window.dataLayer.push(arguments);
    };
    window.gtag("js", new Date());
    window.gtag("config", GA_ID);
  }

  function blockTag() {
    if (!GA_ID) return;
    window["ga-disable-" + GA_ID] = true;
  }

  if (choice === "granted") loadTag();
  else blockTag();

  var bar = null;

  function reserve() {
    if (!bar) return;
    document.documentElement.style.setProperty("--consent-height", bar.offsetHeight + "px");
  }

  function panel(view) {
    bar.innerHTML = view;
    reserve();
  }

  function markChoice(state, open) {
    try {
      localStorage.setItem(KEY, state);
    } catch (e) {
      /* nothing we can do; the choice still applies to this page load */
    }
    if (state === "granted") loadTag();
    else blockTag();
    document.dispatchEvent(new CustomEvent("sprawl:consent", { detail: { choice: state } }));
    if (open === false) close();
  }

  function close() {
    if (bar) {
      bar.remove();
      bar = null;
      document.documentElement.style.setProperty("--consent-height", "0px");
    }
  }

  var ASK =
    '<div class="consentAsk">' +
    '<h2 class="consentTitle">May this page count the visit?</h2>' +
    '<p class="consentText">This page sets nothing until you answer. If you allow it, Google ' +
    'Analytics counts the visit — no profile of you is built here, nothing is sold, and the game ' +
    'itself never sends anything at all. <a href="#privacy">What that means</a>.</p>' +
    '<div class="consentActions">' +
    '<button type="button" class="primary" data-answer="granted">Allow analytics</button>' +
    '<button type="button" data-answer="denied">Only what is needed</button>' +
    "</div></div>";

  function prefs(current) {
    var on = current === "granted";
    return (
      '<div class="consentPrefs" id="consentPrefs">' +
      '<div class="consentHead"><h2 class="consentTitle">Cookie settings</h2>' +
      '<button type="button" class="consentClose" aria-label="Close" data-close>&times;</button></div>' +
      '<ul class="consentList">' +
      '<li class="consentRow"><div><p class="consentRowName">Strictly necessary</p>' +
      '<p class="consentRowWhy">The game itself. It stores your best score in this browser and ' +
      "nothing else, and there is nothing to switch off.</p></div>" +
      '<span class="consentAlways">Always on</span></li>' +
      '<li class="consentRow"><div><p class="consentRowName">Analytics</p>' +
      '<p class="consentRowWhy">Google Analytics, to count visits. Nothing loads from Google ' +
      "unless this is on.</p></div>" +
      '<button type="button" class="consentSwitch" role="switch" aria-checked="' + on + '" ' +
      'aria-label="Analytics cookies" data-switch></button></li>' +
      "</ul>" +
      '<div class="consentActions"><button type="button" class="primary" data-save>Save choice</button></div>' +
      "</div>"
    );
  }

  function open(which) {
    if (!bar) {
      bar = document.createElement("div");
      /* THE IDS ARE THE HOUSE CONTRACT: the family render check finds this bar as `#consentBar`
         and judges the footer door by whether a panel becomes visible. */
      bar.id = "consentBar";
      bar.setAttribute("role", "dialog");
      bar.setAttribute("aria-label", "Cookie choice");
      document.body.appendChild(bar);
      window.addEventListener("resize", reserve);
    }
    panel(which === "ask" ? ASK : prefs(choice));
  }

  /* One listener on the document, for every control in the bar AND for the footer's door. */
  document.addEventListener("click", function (ev) {
    var el = ev.target.closest ? ev.target.closest("[data-answer],[data-switch],[data-save],[data-close],[data-consent-open]") : null;
    if (!el) return;

    if (el.hasAttribute("data-consent-open")) {
      ev.preventDefault();
      open("prefs");
      return;
    }
    if (el.hasAttribute("data-close")) {
      close();
      return;
    }
    if (el.hasAttribute("data-answer")) {
      markChoice(el.getAttribute("data-answer") === "granted" ? "granted" : "denied", false);
      return;
    }
    if (el.hasAttribute("data-switch")) {
      el.setAttribute("aria-checked", el.getAttribute("aria-checked") === "true" ? "false" : "true");
      return;
    }
    if (el.hasAttribute("data-save")) {
      var sw = bar && bar.querySelector("[data-switch]");
      markChoice(sw && sw.getAttribute("aria-checked") === "true" ? "granted" : "denied", false);
    }
  });

  if (choice !== "granted" && choice !== "denied") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { open("ask"); });
    else open("ask");
  }
})();
