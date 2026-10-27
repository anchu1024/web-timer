(() => {
  const INSTANCE_KEY = "__webTimerInstance";
  const START_KEY = "__webTimerStartTime";
  const INTERVAL_MS = 15 * 60 * 1000;

  if (window[INSTANCE_KEY]) {
    return;
  }
  window[INSTANCE_KEY] = true;

  const savedStart = Number(sessionStorage.getItem(START_KEY));
  const startedAt = Number.isFinite(savedStart) && savedStart > 0
    ? savedStart
    : Date.now();
  sessionStorage.setItem(START_KEY, String(startedAt));

  let overlay = null;
  let shadowRoot = null;
  let intervalId = null;
  let nextReminderAt = startedAt + INTERVAL_MS;

  function getElapsedMinutes() {
    return Math.floor((Date.now() - startedAt) / 60000);
  }

  function blockPageInput(event) {
    if (!overlay) {
      return;
    }
    if (event.type === "keydown" && overlay.contains(event.target)) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function removeReminder() {
    if (!overlay) {
      return;
    }
    overlay.remove();
    overlay = null;
    shadowRoot = null;
    document.removeEventListener("keydown", blockPageInput, true);
    document.removeEventListener("wheel", blockPageInput, true);
    document.removeEventListener("touchmove", blockPageInput, true);

    const elapsed = Date.now() - startedAt;
    nextReminderAt = startedAt
      + (Math.floor(elapsed / INTERVAL_MS) + 1) * INTERVAL_MS;
  }

  function showReminder() {
    if (overlay) {
      return;
    }

    overlay = document.createElement("div");
    overlay.setAttribute("aria-live", "assertive");
    overlay.style.cssText = [
      "all: initial",
      "position: fixed",
      "inset: 0",
      "z-index: 2147483647",
      "display: block"
    ].join(";");
    shadowRoot = overlay.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .backdrop {
        position: fixed;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 24px;
        box-sizing: border-box;
        background: rgba(0, 0, 0, .72);
        font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
        color: #172033;
      }
      .dialog {
        width: min(440px, 100%);
        padding: 32px;
        box-sizing: border-box;
        border-radius: 16px;
        background: #fff;
        box-shadow: 0 18px 70px rgba(0, 0, 0, .35);
        text-align: center;
      }
      h1 { margin: 0 0 12px; font-size: 24px; line-height: 1.4; }
      p { margin: 0 0 24px; font-size: 17px; line-height: 1.7; }
      button {
        min-width: 120px;
        padding: 12px 24px;
        border: 0;
        border-radius: 8px;
        background: #2563eb;
        color: #fff;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }
      button:hover { background: #1d4ed8; }
      button:focus-visible { outline: 3px solid #93c5fd; outline-offset: 3px; }
    `;

    const backdrop = document.createElement("div");
    backdrop.className = "backdrop";
    const dialog = document.createElement("section");
    dialog.className = "dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "web-timer-title");
    const title = document.createElement("h1");
    title.id = "web-timer-title";
    title.textContent = "利用時間のお知らせ";
    const message = document.createElement("p");
    message.textContent = `このサイトを開いてから${getElapsedMinutes()}分経過しました。`;
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "閉じる";
    closeButton.addEventListener("click", removeReminder);

    dialog.append(title, message, closeButton);
    backdrop.append(dialog);
    shadowRoot.append(style, backdrop);
    document.documentElement.append(overlay);

    document.addEventListener("keydown", blockPageInput, true);
    document.addEventListener("wheel", blockPageInput, { capture: true, passive: false });
    document.addEventListener("touchmove", blockPageInput, { capture: true, passive: false });
    closeButton.focus();
  }

  function checkTimer() {
    if (!overlay && Date.now() >= nextReminderAt) {
      showReminder();
    }
  }

  function stopTimer() {
    if (intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
    if (overlay) {
      overlay.remove();
      overlay = null;
      shadowRoot = null;
      document.removeEventListener("keydown", blockPageInput, true);
      document.removeEventListener("wheel", blockPageInput, true);
      document.removeEventListener("touchmove", blockPageInput, true);
    }
    chrome.storage.onChanged.removeListener(onSettingsChanged);
    chrome.runtime.onMessage.removeListener(onRuntimeMessage);
    sessionStorage.removeItem(START_KEY);
    delete window[INSTANCE_KEY];
  }

  function onSettingsChanged(changes, areaName) {
    if (areaName !== "sync" || !changes.domains) {
      return;
    }

    const hostname = location.hostname.toLowerCase();
    const stillConfigured = (changes.domains.newValue || []).some(domain =>
      hostname === domain || hostname.endsWith(`.${domain}`)
    );
    if (!stillConfigured) {
      stopTimer();
    }
  }

  function onRuntimeMessage(message, _sender, sendResponse) {
    if (message?.type !== "get-elapsed-time") {
      return false;
    }

    sendResponse({ elapsedMs: Date.now() - startedAt });
    return false;
  }

  chrome.storage.onChanged.addListener(onSettingsChanged);
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  intervalId = window.setInterval(checkTimer, 1000);
  checkTimer();
})();
