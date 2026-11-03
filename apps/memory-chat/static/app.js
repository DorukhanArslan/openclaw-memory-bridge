(() => {
  const $ = (id) => document.getElementById(id);
  let state = null;
  let pending = false;
  let pendingMessage = null;
  let activeTab = "memory";
  let lastConversationId = null;
  const money = new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  });
  const knownStatuses = {
    ok: ["success", "Tamamlandı"],
    success: ["success", "Tamamlandı"],
    completed: ["success", "Tamamlandı"],
    succeeded: ["success", "Tamamlandı"],
    pass: ["success", "Doğrulandı"],
    error: ["error", "Hata"],
    failed: ["error", "Hata"],
    pending: ["pending", "Sürüyor"],
    running: ["pending", "Sürüyor"],
    started: ["pending", "Başladı"],
    info: ["", "Bilgi"],
    warning: ["pending", "Uyarı"],
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function icon(kind) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("aria-hidden", "true");
    const paths = {
      file: "M6 3.5h8l4 4v13H6v-17Zm8 0v5h4M9 12h6M9 15.5h5",
      spark:
        "M12 3v4m0 10v4M3 12h4m10 0h4M5.6 5.6l2.9 2.9m7 7 2.9 2.9M5.6 18.4l2.9-2.9m7-7 2.9-2.9",
      activity: "M3 12h4l3-8 4 16 3-8h4",
      changes: "M7 3v18M3 7h8m4 10h6",
    };
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", paths[kind] || paths.file);
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.5");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
    return svg;
  }

  function errorMessage(message) {
    $("error-text").textContent = message;
    $("error-banner").hidden = !message;
  }

  function isBusy() {
    return pending || Boolean(state?.busy);
  }

  function modelAllowed() {
    if (!state?.model?.ready) return false;
    const remaining = Number(state.budget?.remainingUsd);
    return Number.isFinite(remaining) && remaining > 0;
  }

  function updateControls() {
    const busy = isBusy();
    const replay = Boolean(state && state.mode === "replay");
    document.querySelectorAll("[data-mutates]").forEach((button) => {
      button.disabled = !state || busy || replay;
    });
    document.querySelectorAll(".conversation-item").forEach((button) => {
      button.disabled = busy;
    });
    document.querySelectorAll("[data-prompt]").forEach((button) => {
      button.disabled = !state || busy || replay;
    });
    $("refresh-memory").disabled = busy;
    $("message-input").disabled = !state || busy || replay || !modelAllowed();
    $("send-message").disabled =
      busy || replay || !modelAllowed() || !$("message-input").value.trim();
    $("send-message").classList.toggle(
      "loading",
      pending && Boolean(pendingMessage),
    );
    $("tour-next").disabled =
      !state || busy || replay || (!state.tour?.done && !modelAllowed());
    $("chat-form").setAttribute("aria-busy", String(busy));
    $("export-run").setAttribute("aria-disabled", String(!state || busy));
  }

  function toggleInspector(open) {
    document.body.classList.toggle("inspector-open", open);
    $("toggle-inspector").setAttribute("aria-expanded", String(open));
    $("toggle-inspector").setAttribute(
      "aria-label",
      open ? "Hafıza panelini kapat" : "Hafıza panelini aç",
    );
    updateBackdrop();
  }

  function toggleSidebar(open) {
    document.body.classList.toggle("sidebar-open", open);
    updateBackdrop();
  }

  function updateBackdrop() {
    const small = window.matchMedia("(max-width: 767px)").matches;
    const inspectorOverlay =
      window.matchMedia("(max-width: 1199px)").matches &&
      document.body.classList.contains("inspector-open");
    $("backdrop").hidden = !(
      (small && document.body.classList.contains("sidebar-open")) ||
      inspectorOverlay
    );
    $("sidebar").inert =
      small && !document.body.classList.contains("sidebar-open");
    $("inspector").inert = !document.body.classList.contains("inspector-open");
  }

  function selectTab(tab, focus = false) {
    activeTab = ["memory", "changes", "activity"].includes(tab)
      ? tab
      : "memory";
    document.querySelectorAll("[data-tab]").forEach((button) => {
      const selected = button.dataset.tab === activeTab;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    for (const name of ["memory", "changes", "activity"])
      $(`panel-${name}`).hidden = name !== activeTab;
    if (focus) $(`tab-${activeTab}`).focus();
  }

  function emptyPanel(target, kind, title, copy) {
    const box = el("div", "panel-empty");
    const symbol = el("div", "empty-icon");
    symbol.append(icon(kind));
    box.append(symbol, el("strong", "", title), el("p", "", copy));
    target.replaceChildren(box);
  }

  function renderHistory() {
    const target = $("conversation-list");
    const conversations = Array.isArray(state.conversations)
      ? state.conversations
      : [];
    target.replaceChildren();
    if (!conversations.length) {
      target.append(
        el(
          "p",
          "sidebar-empty",
          "İlk mesajınla birlikte sohbetin burada görünecek.",
        ),
      );
      return;
    }
    for (const conversation of conversations) {
      const button = el(
        "button",
        "conversation-item",
        conversation.title || "Yeni sohbet",
      );
      button.type = "button";
      button.classList.toggle(
        "active",
        conversation.id === state.conversation.id,
      );
      if (conversation.id === state.conversation.id)
        button.setAttribute("aria-current", "page");
      button.title = conversation.title || "Yeni sohbet";
      button.addEventListener("click", () => {
        if (conversation.id !== state.conversation.id)
          mutate(
            "/api/conversations/select",
            { id: conversation.id },
            { closeSidebar: true },
          );
        else toggleSidebar(false);
      });
      target.append(button);
    }
  }

  function appendCitedText(target, content) {
    const text = typeof content === "string" ? content : "";
    const files = new Set((state.memory.files || []).map((file) => file.path));
    const pattern =
      /\[((?:memory\/[a-zA-Z0-9._/-]+\.md|USER\.md|MEMORY\.md|DREAMS\.md))(?::L?\d+(?:-L?\d+)?)?\]/g;
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
      target.append(document.createTextNode(text.slice(cursor, match.index)));
      if (files.has(match[1])) {
        const citation = el("button", "citation", match[0].slice(1, -1));
        citation.type = "button";
        citation.title = "Gerçek kaynağı aç";
        // Keep this source path after the match iterator advances.
        const citedPath = match[1];
        citation.addEventListener("click", () => {
          selectTab("memory");
          toggleInspector(true);
          for (const card of $("memory-files").querySelectorAll("details")) {
            if (card.dataset.path === citedPath) {
              card.open = true;
              card.scrollIntoView({ block: "nearest", behavior: "smooth" });
              break;
            }
          }
        });
        target.append(citation);
      } else target.append(document.createTextNode(match[0]));
      cursor = match.index + match[0].length;
    }
    target.append(document.createTextNode(text.slice(cursor)));
  }

  function messageNode(message) {
    const user = message.role === "user";
    const row = el("article", `message ${user ? "user" : "assistant"}`);
    row.setAttribute("aria-label", user ? "Senin mesajın" : "Model yanıtı");
    const content = el("div", "message-content");
    if (user) content.textContent = message.content || "";
    else appendCitedText(content, message.content);
    if (user) row.append(content);
    else {
      const avatar = el("span", "message-avatar");
      avatar.setAttribute("aria-hidden", "true");
      avatar.append(icon("spark"));
      const body = el("div", "assistant-content");
      body.append(el("span", "message-label", "Memory Chat"), content);
      row.append(avatar, body);
    }
    return row;
  }

  function renderMessages() {
    const scroll = $("chat-scroll");
    const nearBottom =
      scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 150;
    const conversation = state.conversation || { messages: [] };
    const changed = lastConversationId !== conversation.id;
    lastConversationId = conversation.id;
    const messages = (conversation.messages || []).filter(
      (message) => message.role === "user" || message.role === "assistant",
    );
    $("welcome").hidden = messages.length > 0 || Boolean(pendingMessage);
    const target = $("messages");
    target.replaceChildren();
    for (const message of messages) target.append(messageNode(message));
    if (pendingMessage) {
      target.append(messageNode({ role: "user", content: pendingMessage }));
      const row = el("div", "message assistant");
      const avatar = el("span", "message-avatar");
      avatar.append(icon("spark"));
      const dots = el("span", "typing");
      dots.setAttribute("role", "status");
      dots.setAttribute("aria-label", "Gerçek model yanıtı bekleniyor");
      for (let i = 0; i < 3; i += 1) dots.append(el("i"));
      row.append(
        avatar,
        dots,
        el("span", "typing-label", "Kaynaklar ve yanıt hazırlanıyor…"),
      );
      target.append(row);
    }
    if (changed || nearBottom || pendingMessage)
      requestAnimationFrame(() => {
        scroll.scrollTop = scroll.scrollHeight;
      });
  }

  function renderMemory() {
    const files = Array.isArray(state.memory.files) ? state.memory.files : [];
    $("memory-count").textContent = String(files.length);
    $("memory-revision").textContent = state.memory.revision
      ? `kayıt ${String(state.memory.revision).slice(0, 9)}`
      : "kaynak okunmadı";
    const target = $("memory-files");
    const opened = new Set(
      [...target.querySelectorAll("details[open]")].map(
        (card) => card.dataset.path,
      ),
    );
    target.replaceChildren();
    if (!files.length) {
      emptyPanel(
        target,
        "file",
        "Henüz okunmuş bir kaynak yok",
        "Bir bilgiyi hatırlamasını iste. Kullanılan kaynakların SDK okuma çıktıları burada görünecek.",
      );
      return;
    }
    files.forEach((file, index) => {
      const details = el("details", "file-card");
      details.dataset.path = file.path;
      details.open = opened.has(file.path) || (!opened.size && index === 0);
      const summary = el("summary");
      summary.append(icon("file"), el("span", "", file.path));
      summary.title = file.path;
      const source = el("pre", "source-text", file.text || "");
      const metadata = el("div", "file-meta");
      metadata.append(
        el("span", "", `SDK özeti ${(file.sha256 || "").slice(0, 10)}`),
        el(
          "span",
          "",
          `${new TextEncoder().encode(file.text || "").length} bayt`,
        ),
      );
      details.append(summary, source, metadata);
      target.append(details);
    });
  }

  function actualDiff(before, after) {
    const left =
      typeof before === "string" && before.length ? before.split("\n") : [];
    const right =
      typeof after === "string" && after.length ? after.split("\n") : [];
    let prefix = 0;
    while (
      prefix < left.length &&
      prefix < right.length &&
      left[prefix] === right[prefix]
    )
      prefix += 1;
    let suffix = 0;
    while (
      suffix < left.length - prefix &&
      suffix < right.length - prefix &&
      left[left.length - suffix - 1] === right[right.length - suffix - 1]
    )
      suffix += 1;
    const lines = [];
    for (const text of left.slice(Math.max(0, prefix - 2), prefix))
      lines.push({ kind: "context", text });
    for (const text of left.slice(prefix, left.length - suffix))
      lines.push({ kind: "remove", text });
    for (const text of right.slice(prefix, right.length - suffix))
      lines.push({ kind: "add", text });
    for (const text of right.slice(
      right.length - suffix,
      right.length - suffix + Math.min(2, suffix),
    ))
      lines.push({ kind: "context", text });
    return lines;
  }

  function renderChanges() {
    const changes = Array.isArray(state.changes) ? state.changes : [];
    $("changes-count").textContent = String(changes.length);
    const target = $("source-changes");
    target.replaceChildren();
    if (!changes.length) {
      emptyPanel(
        target,
        "changes",
        "Henüz bir değişiklik yok",
        "Hafızaya yazılan veya güncellenen kayıtların önceki ve sonraki satırları burada karşılaştırılır.",
      );
      return;
    }
    for (const change of changes) {
      const card = el("article", "change-card");
      const heading = el("div", "change-heading");
      const lines = actualDiff(change.before, change.after);
      const added = lines.filter((line) => line.kind === "add").length;
      const removed = lines.filter((line) => line.kind === "remove").length;
      const counts = el("span", "change-counts");
      counts.append(
        el("span", "count-add", `+${added}`),
        el("span", "count-remove", `−${removed}`),
      );
      heading.append(el("span", "change-path", change.path), counts);
      card.append(heading);
      if (added || removed) {
        const body = el("div", "diff-content");
        for (const line of lines.slice(0, 500))
          body.append(
            el(
              "span",
              `diff-line ${line.kind}`,
              (line.kind === "add"
                ? "+ "
                : line.kind === "remove"
                  ? "− "
                  : "  ") + line.text,
            ),
          );
        if (lines.length > 500)
          body.append(
            el(
              "span",
              "diff-line context",
              "… Görünüm kısaltıldı. Tam kaynak Kayıtlar sekmesinde.",
            ),
          );
        card.append(body);
      } else card.append(el("p", "diff-empty", "Kaynak satırları aynı."));
      target.append(card);
    }
  }

  function renderActivity() {
    const events = Array.isArray(state.events) ? state.events : [];
    $("activity-count").textContent = String(events.length);
    const target = $("activity-events");
    target.replaceChildren();
    if (!events.length) {
      emptyPanel(
        target,
        "activity",
        "İlk işlem bekleniyor",
        "Arama, kaynak okuma ve kaydetme çağrıları çalıştıklarında burada kendi sonuçlarıyla görünür.",
      );
      return;
    }
    for (const event of events) {
      const details = el("details", "activity-card");
      const summary = el("summary");
      const status = knownStatuses[event.status] || ["", event.status || ""];
      summary.append(
        el("span", `event-dot ${status[0]}`),
        el("span", "event-label", event.label || event.kind || "İşlem"),
        el("span", "event-status", status[1]),
      );
      details.append(summary);
      const detail = event.detail;
      if (detail !== undefined && detail !== null)
        details.append(
          el(
            "pre",
            "activity-detail",
            typeof detail === "string"
              ? detail
              : JSON.stringify(detail, null, 2),
          ),
        );
      target.append(details);
    }
  }

  function render() {
    if (!state) {
      updateControls();
      return;
    }
    state.conversation = state.conversation || { id: "", messages: [] };
    state.memory = state.memory || { files: [], revision: "" };
    const replay = state.mode === "replay";
    const ready = Boolean(state.model?.ready);
    const budget = state.budget || {};
    const noBudget = Number(budget.limitUsd) === 0;
    $("status-line").classList.toggle("ready", ready && !replay);
    const model = state.model?.name
      ? state.model.name.replace(/^openai\//, "")
      : "Gerçek model";
    $("model-status").textContent = replay
      ? `${model} · kayıtlı çalışma`
      : ready
        ? `${model} · canlı model`
        : noBudget
          ? `${model} · sohbet kapalı`
          : "Model bağlantısı ayarlanmamış";
    $("budget-status").textContent = replay
      ? "Yeni model çağrısı yapılmaz"
      : Number.isFinite(Number(budget.remainingUsd))
        ? "Tahmini kalan $" +
          money.format(Math.max(0, Number(budget.remainingUsd)))
        : "";
    document.querySelector(".demo-label").textContent = replay
      ? "tekrar"
      : "demo";
    const tour = state.tour || {};
    $("tour-label").textContent = tour.done
      ? "Kaydı indir"
      : tour.step > 0
        ? "Adım " +
          Math.min(Number(tour.step) + 1, Number(tour.total) || 5) +
          "/" +
          (tour.total || 5)
        : "Rehberli deneme";
    $("tour-next").title =
      tour.label || "Gerçek bir hafıza akışını adım adım dene";
    if (replay)
      $("composer-note").textContent =
        "Bu, gerçek bir çalışmanın salt okunur kaydı. Sohbeti, kaynakları ve gerçekleşen işlemleri inceleyebilirsin.";
    else if (noBudget)
      $("composer-note").textContent =
        "Canlı sohbet için sunucuda bir deneme bütçesi seçilmeli. Kayıtları sağ panelden inceleyebilirsin.";
    else if (!ready)
      $("composer-note").textContent =
        "Canlı sohbet için sunucuda model bağlantısı yapılandırılmalı. Kayıtları sağ panelden inceleyebilirsin.";
    else if (!modelAllowed())
      $("composer-note").textContent =
        "Bu çalışma için sohbet bütçesi kalmadı. Mevcut kayıtları inceleyebilir ve çalışma kaydını indirebilirsin.";
    else
      $("composer-note").textContent =
        "Enter ile gönder, Shift + Enter ile yeni satır. Yanıtın kaynağını da kontrol et.";
    renderHistory();
    renderMessages();
    renderMemory();
    renderChanges();
    renderActivity();
    updateControls();
    if (state.error) errorMessage(state.error);
  }

  async function request(path, body) {
    const options = {
      method: body === undefined ? "GET" : "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    };
    if (body !== undefined) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    const response = await fetch(path, options);
    let value;
    try {
      value = await response.json();
    } catch {
      throw new Error(
        "Sunucudan okunabilir bir yanıt gelmedi. Bağlantıyı ve sunucu terminalini kontrol et.",
      );
    }
    if (!response.ok) {
      if (value.state) state = value.state;
      throw new Error(
        typeof value.error === "string" ? value.error : "İşlem tamamlanamadı.",
      );
    }
    if (!value || typeof value !== "object" || !value.conversation)
      throw new Error(
        "Sunucu durumu eksik. İşlemin sonucunu sunucu terminalinden kontrol et.",
      );
    return value;
  }

  async function mutate(path, body, options = {}) {
    if (
      isBusy() ||
      (state && state.mode === "replay" && path !== "/api/conversations/select")
    )
      return;
    pending = true;
    pendingMessage = options.message || null;
    errorMessage("");
    if (options.closeSidebar) toggleSidebar(false);
    render();
    let succeeded = false;
    try {
      state = await request(path, body);
      succeeded = true;
    } catch (error) {
      errorMessage(error.message || "İşlem tamamlanamadı.");
    } finally {
      pending = false;
      pendingMessage = null;
      render();
      if (succeeded && options.message) {
        $("message-input").value = "";
        resizeInput();
      }
      updateControls();
      if (succeeded && options.focusInput && modelAllowed())
        $("message-input").focus();
    }
  }

  function resizeInput() {
    const input = $("message-input");
    input.style.height = "auto";
    input.style.height = `${Math.min(170, input.scrollHeight)}px`;
  }

  $("chat-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const message = $("message-input").value.trim();
    if (!message || !modelAllowed() || isBusy()) return;
    mutate("/api/chat", { message }, { message, focusInput: true });
  });
  $("message-input").addEventListener("input", () => {
    resizeInput();
    updateControls();
  });
  $("message-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      $("chat-form").requestSubmit();
    }
  });
  $("new-chat").addEventListener("click", () =>
    mutate("/api/conversations", {}, { closeSidebar: true, focusInput: true }),
  );
  $("restart-memory").addEventListener("click", () =>
    mutate("/api/restart", {}, { focusInput: true }),
  );
  $("tour-next").addEventListener("click", () => {
    if (state?.tour?.done) {
      window.location.assign("/api/export");
      return;
    }
    mutate("/api/tour/next", {});
  });
  $("refresh-memory").addEventListener("click", async () => {
    if (isBusy()) return;
    pending = true;
    updateControls();
    errorMessage("");
    try {
      state = await request("/api/state");
    } catch (error) {
      errorMessage(error.message);
    } finally {
      pending = false;
      render();
    }
  });
  $("toggle-inspector").addEventListener("click", () =>
    toggleInspector(!document.body.classList.contains("inspector-open")),
  );
  $("close-inspector").addEventListener("click", () => toggleInspector(false));
  $("open-sidebar").addEventListener("click", () => toggleSidebar(true));
  $("close-sidebar").addEventListener("click", () => toggleSidebar(false));
  $("backdrop").addEventListener("click", () => {
    toggleSidebar(false);
    toggleInspector(false);
  });
  $("dismiss-error").addEventListener("click", () => errorMessage(""));
  $("export-run").addEventListener("click", (event) => {
    if (!state || isBusy()) event.preventDefault();
  });
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => selectTab(button.dataset.tab));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
        return;
      event.preventDefault();
      const tabs = ["memory", "changes", "activity"];
      const index = tabs.indexOf(activeTab);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? 2
            : (index + (event.key === "ArrowRight" ? 1 : 2)) % 3;
      selectTab(tabs[next], true);
    });
  });
  document.querySelectorAll("[data-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      if (isBusy()) return;
      $("message-input").value = button.dataset.prompt;
      resizeInput();
      updateControls();
      if (!$("message-input").disabled) $("message-input").focus();
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      toggleSidebar(false);
      toggleInspector(false);
    }
  });
  window.addEventListener("resize", updateBackdrop);
  toggleInspector(window.matchMedia("(min-width: 1200px)").matches);
  selectTab("memory");
  updateControls();
  request("/api/state")
    .then((value) => {
      state = value;
      render();
    })
    .catch((error) => {
      $("model-status").textContent = "Sunucuya bağlanılamadı";
      $("budget-status").textContent = "";
      errorMessage(error.message || "Uygulamaya bağlanılamadı.");
      updateControls();
    });
})();
