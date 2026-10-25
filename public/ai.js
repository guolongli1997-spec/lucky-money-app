/**
 * FlyTripVisa AI layer
 * Adds real-time AI answers to every option on the page without touching its markup or styles.
 * Talks to the Worker's POST /api/chat (SSE stream). Load it AFTER the page's own <script>.
 */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var points = function () { try { return currentPoints; } catch (e) { return 0; } };
  var history = function () { try { return getHistory(); } catch (e) { return []; } };

  /* ---------- answer sheet: built from the page's own modal classes ---------- */
  var css = document.createElement("style");
  css.textContent =
    "#aiBody{font-size:15px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--color-text);min-height:56px}";
  document.head.appendChild(css);

  var overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "aiModal";
  overlay.innerHTML =
    '<div class="modal-sheet"><div class="modal-handle"></div>' +
    '<div class="modal-title" id="aiTitle"></div><div id="aiBody"></div>' +
    '<button class="modal-close-btn" id="aiClose" type="button">Close</button></div>';
  document.body.appendChild(overlay);

  var sheet = overlay.firstChild, titleEl = $("aiTitle"), bodyEl = $("aiBody"), ctl = null;

  function closeSheet() {
    if (ctl) ctl.abort();
    overlay.classList.remove("active");
  }
  $("aiClose").addEventListener("click", closeSheet);
  overlay.addEventListener("click", function (e) { if (e.target === overlay) closeSheet(); });

  /* ---------- what the AI knows about this page ---------- */
  function system() {
    var rewards = Array.prototype.map.call(document.querySelectorAll(".redeem-card"), function (c) {
      return "- " + c.dataset.name + ": " + c.dataset.cost + " Pts";
    }).join("\n");
    var rules = Array.prototype.map.call(document.querySelectorAll(".rules-list li"), function (l) {
      return "- " + l.textContent.trim();
    }).join("\n");
    var recent = history().slice(0, 8).map(function (h) { return "- " + h.label + " " + h.value; }).join("\n") || "- none yet";
    return (
      "You are the in-app assistant of FlyTripVisa Points Center. Answer only about this points center. " +
      "Be short, friendly and concrete (max about 80 words). Reply in the same language as the user's own words; " +
      "when the message describes a tapped option, reply in English. Never invent rewards, prices or rules.\n\n" +
      "Current balance: " + points() + " Pts\nRewards:\n" + rewards + "\nRules:\n" + rules +
      "\nRecent activity:\n" + recent + "\nCustomer service: 95188"
    );
  }

  /* ---------- streaming request (same SSE handling as the template's chat.js) ---------- */
  function events(buffer) {
    var s = buffer.replace(/\r/g, ""), out = [], i;
    while ((i = s.indexOf("\n\n")) !== -1) {
      var data = s.slice(0, i).split("\n").filter(function (l) { return l.indexOf("data:") === 0; })
        .map(function (l) { return l.slice(5).trimStart(); }).join("\n");
      s = s.slice(i + 2);
      if (data) out.push(data);
    }
    return { events: out, rest: s };
  }
  function piece(data) {
    try {
      var j = JSON.parse(data);
      if (typeof j.response === "string") return j.response;
      var c = j.choices && j.choices[0];
      return (c && c.delta && c.delta.content) || "";
    } catch (e) { return ""; }
  }

  async function ask(title, prompt) {
    if (ctl) ctl.abort();
    ctl = new AbortController();
    var mine = ctl;
    titleEl.textContent = "🤖 " + title;
    bodyEl.textContent = "Thinking…";
    overlay.classList.add("active");
    try {
      var res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "system", content: system() }, { role: "user", content: prompt }] }),
        signal: mine.signal
      });
      if (!res.ok || !res.body) throw new Error("bad response");
      var reader = res.body.getReader(), dec = new TextDecoder(), buf = "", text = "", done = false;
      while (!done) {
        var r = await reader.read();
        buf += dec.decode(r.value || new Uint8Array(), { stream: !r.done }) + (r.done ? "\n\n" : "");
        var p = events(buf); buf = p.rest;
        for (var k = 0; k < p.events.length; k++) {
          if (p.events[k] === "[DONE]") { done = true; break; }
          text += piece(p.events[k]);
        }
        if (text) { bodyEl.textContent = text; sheet.scrollTop = sheet.scrollHeight; }
        if (r.done) done = true;
      }
      if (!text) bodyEl.textContent = "No answer received. Please try again.";
    } catch (err) {
      if (mine.signal.aborted) return;
      bodyEl.textContent = "Sorry, the AI could not answer right now. Please try again.";
    }
  }

  /* ---------- every option on the page ---------- */
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t.closest || t.closest("#aiModal")) return;
    var before = points(), card, li, job = null;

    if ((card = t.closest(".redeem-card"))) {
      var name = card.dataset.name, cost = parseInt(card.dataset.cost, 10);
      job = function () {
        var now = points();
        return [name, 'The user tapped the reward "' + name + '" (' + cost + " Pts). " +
          (now < before
            ? "The redemption just succeeded. New balance: " + now + " Pts. Confirm it and say what happens next."
            : "Redemption failed: balance " + now + " Pts, short by " + (cost - now) + " Pts. Explain and suggest how to earn more or a cheaper reward.")];
      };
    } else if (t.closest("#detailLink")) {
      job = function () { return ["Points Details", "The user opened Points Details. Summarize their recent activity and balance."]; };
    } else if (t.closest("#exchangeBanner")) {
      job = function () { return ["Points Exchange", "The user tapped Points Exchange / Redeem Now. List which rewards they can afford right now and recommend one."]; };
    } else if (t.closest(".points-card")) {
      job = function () { return ["My Points", "The user tapped their points card. Explain the balance, what it can buy, and how to earn more."]; };
    } else if ((li = t.closest(".rules-list li"))) {
      var rule = li.textContent.trim();
      job = function () { return ["Rule", 'Explain this rule simply: "' + rule + '"']; };
    } else if (t.closest(".rules-card")) {
      job = function () { return ["How Points Work", "The user tapped the redemption rules. Summarize the rules in a few lines."]; };
    }

    // run after the page's own handlers so balances and history are already updated
    if (job) setTimeout(function () { var a = job(); ask(a[0], a[1]); }, 0);
  }, true);

  /* search bar, suggestions and voice all end in doSearch(): keep the page's instant result, add the AI answer */
  if (typeof window.doSearch === "function") {
    var original = window.doSearch;
    window.doSearch = function () {
      var input = $("consoleInput"), q = input ? input.value.trim() : "";
      original.apply(this, arguments);
      if (!q) return;
      var banner = $("searchResult");
      if (banner && banner.textContent.indexOf("No results") !== -1) banner.classList.remove("active");
      ask(q.length > 28 ? q.slice(0, 28) + "…" : q, q);
    };
  }
})();
