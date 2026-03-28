(function () {
  "use strict";

  // ── Config ──────────────────────────────────────────────
  // In production this is your Render/Railway backend URL
  // In dev it's the same origin
  const BACKEND =
    window.GHOST_BACKEND ||
    (location.hostname === "localhost" || location.hostname === "127.0.0.1"
      ? ""
      : ""); // Set this to your deployed backend URL e.g. "https://ghostproxy.onrender.com"

  // ── Elements ─────────────────────────────────────────────
  const urlInput = document.getElementById("url-input");
  const navForm = document.getElementById("nav-form");
  const frame = document.getElementById("proxy-frame");
  const homeScreen = document.getElementById("home-screen");
  const loadingBar = document.getElementById("loading-bar");
  const errorScreen = document.getElementById("error-screen");
  const errorMsg = document.getElementById("error-msg");
  const statusText = document.getElementById("status-text");
  const btnBack = document.getElementById("btn-back");
  const btnForward = document.getElementById("btn-forward");
  const btnReload = document.getElementById("btn-reload");
  const btnHome = document.getElementById("btn-home");
  const errorRetry = document.getElementById("error-retry");

  // ── State ────────────────────────────────────────────────
  let history = [];
  let historyIdx = -1;
  let currentUrl = "";
  let loadingTimer = null;

  // ── URL Encoding ─────────────────────────────────────────
  function encodeUrl(url) {
    return btoa(url)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  function buildProxyUrl(targetUrl) {
    return BACKEND + "/go/" + encodeUrl(targetUrl);
  }

  function normalizeInput(raw) {
    raw = raw.trim();
    // If it looks like a search query, go to Google
    if (!raw.includes(".") || raw.includes(" ")) {
      return "https://www.google.com/search?q=" + encodeURIComponent(raw);
    }
    // Add protocol if missing
    if (!/^https?:\/\//i.test(raw)) {
      return "https://" + raw;
    }
    return raw;
  }

  // ── Navigation ───────────────────────────────────────────
  function navigate(url) {
    url = normalizeInput(url);
    if (!url) return;

    currentUrl = url;
    urlInput.value = url;

    // Update history
    history = history.slice(0, historyIdx + 1);
    history.push(url);
    historyIdx = history.length - 1;
    updateNavButtons();

    showLoading(url);
    loadUrl(url);
  }

  function loadUrl(url) {
    const proxyUrl = buildProxyUrl(url);
    frame.src = proxyUrl;
    showFrame();
  }

  function showFrame() {
    homeScreen.classList.add("hidden");
    errorScreen.classList.add("hidden");
    frame.classList.remove("hidden");
  }

  function showHome() {
    frame.classList.add("hidden");
    errorScreen.classList.add("hidden");
    homeScreen.classList.remove("hidden");
    urlInput.value = "";
    statusText.textContent = "Ready";
    currentUrl = "";
    stopLoading();
  }

  function showError(msg) {
    stopLoading();
    frame.classList.add("hidden");
    homeScreen.classList.add("hidden");
    errorScreen.classList.remove("hidden");
    errorMsg.textContent = msg || "The site could not be reached.";
    statusText.textContent = "Error";
  }

  function showLoading(url) {
    loadingBar.classList.remove("hidden");
    statusText.textContent = "Loading " + url + "...";
    if (loadingTimer) clearTimeout(loadingTimer);
    loadingTimer = setTimeout(stopLoading, 8000);
  }

  function stopLoading() {
    loadingBar.classList.add("hidden");
    if (loadingTimer) {
      clearTimeout(loadingTimer);
      loadingTimer = null;
    }
  }

  function updateNavButtons() {
    btnBack.disabled = historyIdx <= 0;
    btnForward.disabled = historyIdx >= history.length - 1;
  }

  // ── Event Listeners ──────────────────────────────────────
  navForm.addEventListener("submit", (e) => {
    e.preventDefault();
    navigate(urlInput.value);
  });

  btnBack.addEventListener("click", () => {
    if (historyIdx > 0) {
      historyIdx--;
      updateNavButtons();
      const url = history[historyIdx];
      currentUrl = url;
      urlInput.value = url;
      showLoading(url);
      loadUrl(url);
    }
  });

  btnForward.addEventListener("click", () => {
    if (historyIdx < history.length - 1) {
      historyIdx++;
      updateNavButtons();
      const url = history[historyIdx];
      currentUrl = url;
      urlInput.value = url;
      showLoading(url);
      loadUrl(url);
    }
  });

  btnReload.addEventListener("click", () => {
    if (currentUrl) {
      showLoading(currentUrl);
      loadUrl(currentUrl);
    }
  });

  btnHome.addEventListener("click", showHome);

  errorRetry.addEventListener("click", () => {
    if (currentUrl) {
      showLoading(currentUrl);
      loadUrl(currentUrl);
    }
  });

  // Quick links on home screen
  document.querySelectorAll(".quick-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      navigate(link.dataset.url);
    });
  });

  // Listen for iframe load events
  frame.addEventListener("load", () => {
    stopLoading();
    statusText.textContent = currentUrl || "Ready";
    urlInput.value = currentUrl;
  });

  frame.addEventListener("error", () => {
    showError("Could not connect to the site. It may be down or blocked.");
  });

  // Keyboard shortcut: Ctrl+L to focus URL bar
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "l") {
      e.preventDefault();
      urlInput.focus();
      urlInput.select();
    }
  });

  // Init
  updateNavButtons();
})();
