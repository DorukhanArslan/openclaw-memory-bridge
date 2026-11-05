(() => {
  const $ = (id) => document.getElementById(id);
  let state = null;
  let pending = false;
  let pendingMessage = null;
  let pendingMessageCount = 0;
  let polling = false;
  let cancelling = false;
  let refreshing = false;
  let activeTab = "memory";
  let lastConversationId = null;
  const renderedViews = new Map();
  const money = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  });
  const knownStatuses = {
    ok: ["success", "Completed"],
    success: ["success", "Completed"],
    completed: ["success", "Completed"],
    succeeded: ["success", "Completed"],
    pass: ["success", "Verified"],
    error: ["error", "Error"],
    failed: ["error", "Error"],
    pending: ["pending", "Running"],
    running: ["pending", "Running"],
    started: ["pending", "Started"],
    info: ["", "Info"],
    warning: ["pending", "Warning"],
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function changedView(name, value) {
    const signature = JSON.stringify(value);
    if (renderedViews.get(name) === signature) return false;
    renderedViews.set(name, signature);
    return true;
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

  function conversationBlocked() {
    return Boolean(state?.conversation?.blocked);
  }

  function conversationReadOnly() {
    return Boolean(state?.conversation?.readOnly);
  }

  function modelAllowed() {
    if (!state?.model?.ready) return false;
    const remaining = Number(state.budget?.remainingUsd);
    return Number.isFinite(remaining) && remaining > 0;
  }

  function updateControls() {
    const busy = isBusy();
    const replay = Boolean(state && state.mode === "replay");
    const blocked = conversationBlocked();
    const readOnly = conversationReadOnly();
    document.querySelectorAll("[data-mutates]").forEach((button) => {
      button.disabled = !state || busy || replay;
    });
    document.querySelectorAll(".conversation-item").forEach((button) => {
      button.disabled = busy;
    });
    document.querySelectorAll("[data-prompt]").forEach((button) => {
      button.disabled = !state || replay || blocked || readOnly;
    });
    $("refresh-memory").disabled = !state || refreshing;
    $("refresh-memory").title = busy
      ? "Refresh operation status"
      : "Refresh memory";
    $("message-input").disabled =
      !state || replay || blocked || readOnly || (!busy && !modelAllowed());
    $("send-message").disabled =
      busy ||
      replay ||
      blocked ||
      readOnly ||
      !modelAllowed() ||
      !$("message-input").value.trim();
    $("send-message").classList.toggle(
      "loading",
      pending && Boolean(pendingMessage),
    );
    $("tour-next").disabled =
      !state ||
      busy ||
      replay ||
      blocked ||
      readOnly ||
      (!state.tour?.done && !modelAllowed());
    $("chat-form").setAttribute("aria-busy", String(busy));
    $("export-run").setAttribute("aria-disabled", String(!state));
    const activeJob = Boolean(state?.busy);
    const stopping = cancelling || state?.job?.status === "cancelling";
    $("job-bar").hidden = !busy;
    $("job-label").textContent = state?.job?.label || "Starting your request…";
    const startedAt = Date.parse(state?.job?.startedAt || "");
    $("job-elapsed").textContent = Number.isFinite(startedAt)
      ? `${Math.max(0, Math.floor((Date.now() - startedAt) / 1000))}s`
      : "";
    $("cancel-job").disabled = !activeJob || stopping || replay;
    $("cancel-job").textContent = stopping ? "Stopping…" : "Stop";
    $("cancel-job").title = stopping
      ? "Waiting for the current bounded request to finish. No further action will be started."
      : "Stop after the current request; do not start further model or memory actions";
  }

  function toggleInspector(open) {
    document.body.classList.toggle("inspector-open", open);
    $("toggle-inspector").setAttribute("aria-expanded", String(open));
    $("toggle-inspector").setAttribute(
      "aria-label",
      open ? "Close memory panel" : "Open memory panel",
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
    if (!changedView("history", [state.conversations, state.conversation.id]))
      return;
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
          "Your chats will appear here after your first message.",
        ),
      );
      return;
    }
    for (const conversation of conversations) {
      const button = el(
        "button",
        "conversation-item",
        conversation.title || "New chat",
      );
      button.type = "button";
      button.classList.toggle(
        "active",
        conversation.id === state.conversation.id,
      );
      if (conversation.id === state.conversation.id)
        button.setAttribute("aria-current", "page");
      button.title = conversation.title || "New chat";
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
        citation.title = "Open the actual source";
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
    row.setAttribute("aria-label", user ? "Your message" : "Model response");
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
    if (
      !changedView("messages", [
        state.conversation,
        pendingMessage,
        isBusy(),
        state.job?.label,
      ])
    )
      return;
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
    const pendingCommitted = messages
      .slice(pendingMessageCount)
      .some(
        (message) =>
          message.role === "user" && message.content === pendingMessage,
      );
    if (pendingMessage && !pendingCommitted)
      target.append(messageNode({ role: "user", content: pendingMessage }));
    if (isBusy()) {
      const row = el("div", "message assistant");
      const avatar = el("span", "message-avatar");
      avatar.append(icon("spark"));
      const dots = el("span", "typing");
      dots.setAttribute("role", "status");
      dots.setAttribute(
        "aria-label",
        state.job?.label || "Request in progress",
      );
      for (let i = 0; i < 3; i += 1) dots.append(el("i"));
      row.append(
        avatar,
        dots,
        el(
          "span",
          "typing-label",
          state.job?.label || "Waiting for the model…",
        ),
      );
      target.append(row);
    }
    if (changed || nearBottom)
      requestAnimationFrame(() => {
        scroll.scrollTop = scroll.scrollHeight;
      });
  }

  function renderMemory() {
    if (!changedView("memory", state.memory)) return;
    const files = Array.isArray(state.memory.files) ? state.memory.files : [];
    const lifecycle = state.memory.lifecycle;
    const native = lifecycle?.mode === "native-chat";
    $("conversation-memory").hidden = !native;
    if (native) {
      let title = "Conversation memory";
      let copy =
        "OpenClaw saves conversation history as you chat. Curated memory notes are shown separately below.";
      if (lifecycle.error) {
        title = "Conversation memory needs attention";
        copy = lifecycle.error;
      } else if (lifecycle.pendingIndex) {
        title = lifecycle.transcriptPersisted
          ? "Conversation saved"
          : "Preparing conversation memory";
        copy =
          "Choose New chat to prepare this conversation for recall before starting the next one.";
      } else if (lifecycle.indexed) {
        title = "Available across chats";
        copy =
          "Saved conversation history is ready for recall in a new chat. This is separate from curated memory notes.";
      } else if (lifecycle.transcriptPersisted) {
        title = "Conversation saved";
        copy =
          "Your messages are stored in conversation history. Recall readiness is shown here when verified.";
      }
      $("conversation-memory-title").textContent = title;
      $("conversation-memory-copy").textContent = copy;
      $("conversation-memory").classList.toggle(
        "needs-attention",
        Boolean(lifecycle.error),
      );
    }
    $("memory-count").textContent = String(files.length);
    $("memory-revision").textContent = state.memory.revision
      ? `capture ${String(state.memory.revision).slice(0, 9)}`
      : "no sources read";
    const unavailable = state.memory.available === false;
    const stale = Boolean(state.memory.stale);
    $("memory-warning").hidden = !unavailable && !stale && !state.memory.error;
    $("memory-warning-title").textContent = unavailable
      ? "Memory is unavailable"
      : "Previously captured sources";
    $("memory-warning-copy").textContent = unavailable
      ? (native
          ? "OpenClaw could not verify the saved sources."
          : "Chat still works. Saved facts could not be verified.") +
        (files.length
          ? " These excerpts are from the last verified capture."
          : "")
      : "These source excerpts have not been checked during this session. Refresh memory to verify them.";
    $("memory-warning-detail").textContent = state.memory.error || "";
    $("memory-warning-details").hidden = !state.memory.error;
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
        native ? "No memory notes read yet" : "No sources read yet",
        native
          ? "Conversation history can support recall without a separate note for every message. Source excerpts appear here when read."
          : "Ask the assistant to remember something. SDK output from the sources used will appear here.",
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
        el("span", "", `SDK hash ${(file.sha256 || "").slice(0, 10)}`),
        el(
          "span",
          "",
          `${new TextEncoder().encode(file.text || "").length} bytes`,
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
    if (!changedView("changes", state.changes)) return;
    const changes = Array.isArray(state.changes) ? state.changes : [];
    $("changes-count").textContent = String(changes.length);
    const target = $("source-changes");
    target.replaceChildren();
    if (!changes.length) {
      emptyPanel(
        target,
        "changes",
        "No changes yet",
        "Compare the source lines before and after a memory write or update.",
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
              "… Display shortened. See the source excerpt in the Sources tab.",
            ),
          );
        card.append(body);
      } else card.append(el("p", "diff-empty", "Source lines are unchanged."));
      target.append(card);
    }
  }

  function renderActivity() {
    if (!changedView("activity", state.events)) return;
    const events = Array.isArray(state.events) ? state.events : [];
    $("activity-count").textContent = String(events.length);
    const target = $("activity-events");
    const opened = new Set(
      [...target.querySelectorAll("details[open]")].map(
        (card) => card.dataset.key,
      ),
    );
    target.replaceChildren();
    if (!events.length) {
      emptyPanel(
        target,
        "activity",
        "Waiting for the first action",
        "Search, source reads, and save calls appear here with their actual results.",
      );
      return;
    }
    for (const [index, event] of events.entries()) {
      const details = el("details", "activity-card");
      details.dataset.key = `${index}:${event.kind}:${event.label}`;
      details.open = opened.has(details.dataset.key);
      const summary = el("summary");
      const status = knownStatuses[event.status] || ["", event.status || ""];
      summary.append(
        el("span", `event-dot ${status[0]}`),
        el("span", "event-label", event.label || event.kind || "Action"),
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
      : "Real model";
    $("model-status").textContent = replay
      ? `${model} · recorded run`
      : ready
        ? `${model} · live model`
        : noBudget
          ? `${model} · chat disabled`
          : state.model?.reason === "allowance_exhausted"
            ? `${model} · local budget exhausted`
            : state.model?.reason === "allowance_unavailable"
              ? `${model} · cost accounting paused`
              : "Model connection is not configured";
    $("budget-status").textContent = replay
      ? "No new model calls"
      : Number.isFinite(Number(budget.remainingUsd))
        ? "Local budget left $" +
          money.format(Math.max(0, Number(budget.remainingUsd)))
        : "";
    $("budget-status").title = replay
      ? "Recorded usage; no new model calls."
      : `Provider-reported cost: $${Number(budget.providerReportedCostUsd || 0).toFixed(6)}. ` +
        `Unsettled estimates: $${Number(budget.unsettledEstimateUsd || 0).toFixed(6)}. ` +
        "This local allowance is not the provider's account balance.";
    document.querySelector(".demo-label").textContent = replay
      ? "replay"
      : "demo";
    const tour = state.tour || {};
    const blocked = conversationBlocked();
    $("tour-label").textContent = tour.done
      ? "Download capture"
      : tour.step > 0
        ? "Step " +
          Math.min(Number(tour.step) + 1, Number(tour.total) || 5) +
          "/" +
          (tour.total || 5)
        : "Guided walkthrough";
    $("tour-next").title = conversationReadOnly()
      ? "Start a new chat to use conversation memory."
      : blocked
        ? "Start a new chat to continue the walkthrough using the saved memory."
        : tour.label || "Try a real memory flow, one step at a time";
    if (replay)
      $("composer-note").textContent =
        "This is a read-only run capture. Explore the conversation, sources, and executed actions.";
    else if (conversationReadOnly())
      $("composer-note").textContent =
        "This earlier demo conversation is read-only. Start a new chat to use conversation memory.";
    else if (blocked)
      $("composer-note").textContent =
        "This conversation stopped after a failed operation. Start a new chat to keep using the saved memory.";
    else if (noBudget)
      $("composer-note").textContent =
        "Choose a demo budget on the server to enable live chat. You can still inspect the sources.";
    else if (!ready)
      $("composer-note").textContent =
        "Configure the model connection on the server to enable live chat. You can still inspect the sources.";
    else if (!modelAllowed())
      $("composer-note").textContent =
        "This run has no chat allowance left. You can inspect the sources and download the capture.";
    else
      $("composer-note").textContent =
        "Enter to send, Shift + Enter for a new line. Check the sources behind the answer.";
    $("notice-banner").textContent = state.notice || "";
    $("notice-banner").hidden = !state.notice;
    renderHistory();
    renderMessages();
    renderMemory();
    renderChanges();
    renderActivity();
    updateControls();
  }

  async function request(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const options = {
      method: body === undefined ? "GET" : "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    };
    if (body !== undefined) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    try {
      const response = await fetch(path, options);
      let value;
      try {
        value = await response.json();
      } catch (error) {
        if (error.name === "AbortError") throw error;
        throw new Error(
          "The server returned an unreadable response. Check the server terminal.",
        );
      }
      if (!response.ok) {
        if (value.state) state = value.state;
        throw new Error(
          typeof value.error === "string"
            ? value.error
            : "The operation could not be completed.",
        );
      }
      if (!value || typeof value !== "object" || !value.conversation)
        throw new Error(
          "The server state is incomplete. Check the server terminal.",
        );
      return value;
    } catch (error) {
      if (error.name === "AbortError")
        throw new Error(
          "The server did not respond within 10 seconds. The request may still be running; refresh its status before submitting it again.",
        );
      if (error instanceof TypeError)
        throw new Error(
          "Could not reach the local server. Keep its terminal open and refresh the operation status before trying again.",
        );
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function waitForJob() {
    if (!state?.busy || polling) return;
    polling = true;
    const deadline = performance.now() + 165000;
    try {
      while (state?.busy) {
        if (performance.now() >= deadline)
          throw new Error(
            "This operation is taking longer than expected. The page is still usable: stop the operation or refresh its status. It has not been retried.",
          );
        await new Promise((resolve) => setTimeout(resolve, 600));
        state = await request("/api/state");
        render();
      }
    } finally {
      polling = false;
    }
  }

  function showJobOutcome() {
    if (state?.job?.status === "failed")
      errorMessage(
        state.job.error ||
          state.error ||
          "The operation failed. You can try a new message.",
      );
    else if (state?.job?.status === "cancelled")
      errorMessage(
        state.job.error ||
          "The operation was stopped. No further action was started.",
      );
  }

  async function watchExistingJob() {
    if (polling || !state?.busy) return;
    try {
      await waitForJob();
      showJobOutcome();
    } catch (error) {
      errorMessage(error.message);
    } finally {
      render();
    }
  }

  async function cancelJob() {
    if (!state?.busy || cancelling || state.mode === "replay") return;
    cancelling = true;
    updateControls();
    try {
      state = await request("/api/cancel", {});
      render();
      if (!polling) await watchExistingJob();
    } catch (error) {
      errorMessage(error.message);
    } finally {
      cancelling = false;
      updateControls();
    }
  }

  async function mutate(path, body, options = {}) {
    if (
      isBusy() ||
      ((conversationBlocked() || conversationReadOnly()) &&
        ["/api/chat", "/api/tour/next"].includes(path)) ||
      (state && state.mode === "replay" && path !== "/api/conversations/select")
    )
      return;
    pending = true;
    pendingMessage = options.message || null;
    pendingMessageCount = state?.conversation?.messages?.length || 0;
    errorMessage("");
    if (options.closeSidebar) toggleSidebar(false);
    render();
    let succeeded = false;
    const previousJobId = state?.job?.id;
    try {
      state = await request(path, body);
      render();
      const startedJob =
        state.busy || (state.job?.id && state.job.id !== previousJobId);
      if (startedJob) {
        await waitForJob();
        succeeded = !["failed", "cancelled"].includes(state?.job?.status);
        showJobOutcome();
      } else succeeded = true;
    } catch (error) {
      errorMessage(error.message || "The operation could not be completed.");
    } finally {
      pending = false;
      pendingMessage = null;
      render();
      if (
        succeeded &&
        options.message &&
        $("message-input").value === options.message
      ) {
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
    if (
      !message ||
      !modelAllowed() ||
      isBusy() ||
      conversationBlocked() ||
      conversationReadOnly()
    )
      return;
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
    if (refreshing) return;
    if (!isBusy()) {
      mutate("/api/memory/refresh", {});
      return;
    }
    refreshing = true;
    updateControls();
    errorMessage("");
    try {
      state = await request("/api/state");
      if (state.busy && !polling) watchExistingJob();
      else showJobOutcome();
    } catch (error) {
      errorMessage(error.message);
    } finally {
      refreshing = false;
      render();
    }
  });
  $("cancel-job").addEventListener("click", cancelJob);
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
    if (!state) event.preventDefault();
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
      if (state?.mode === "replay" || conversationBlocked()) return;
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
      if (state.error) errorMessage(state.error);
      if (state.busy) watchExistingJob();
    })
    .catch((error) => {
      $("model-status").textContent = "Could not connect to the server";
      $("budget-status").textContent = "";
      errorMessage(error.message || "Could not connect to the app.");
      updateControls();
    });
})();
