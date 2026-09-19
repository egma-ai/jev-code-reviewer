(function attachJevReviewerUI(global) {
  "use strict";

  const PRIORITIES = ["P0", "P1", "P2"];
  const DEFAULT_DISPLAY = Object.freeze({
    visible: { P0: true, P1: true, P2: true },
    expanded: { P0: true, P1: false, P2: false },
    showNativeDiff: false
  });

  function text(value, fallback = "") {
    if (typeof value !== "string") return fallback;
    const clean = value.trim();
    return clean ? clean.slice(0, 30000) : fallback;
  }

  function asArray(value, max = 100) {
    return Array.isArray(value) ? value.slice(0, max) : [];
  }

  function stringArray(value, max = 50) {
    return asArray(value, max).map((item) => text(item)).filter(Boolean);
  }

  function priority(value) {
    const normalized = String(value || "").toUpperCase();
    return PRIORITIES.includes(normalized) ? normalized : "P0";
  }

  function normalizeEvidence(item) {
    if (typeof item === "string") return { path: "", snippet: text(item) };
    if (!item || typeof item !== "object") return null;
    const startLine = Number(item.startLine ?? item.start_line);
    const endLine = Number(item.endLine ?? item.end_line);
    return {
      path: text(item.path),
      startLine: Number.isInteger(startLine) && startLine > 0 ? startLine : null,
      endLine: Number.isInteger(endLine) && endLine > 0 ? endLine : null,
      side: item.side === "old" ? "old" : "new",
      snippet: text(item.snippet)
    };
  }

  function normalizeChange(item, index) {
    const source = item && typeof item === "object" ? item : {};
    return {
      id: text(source.id, `change-${index + 1}`),
      title: text(source.title, `Change ${index + 1}`),
      priority: priority(source.priority),
      oldLogic: text(source.oldLogic ?? source.old_logic, "No old-logic explanation was provided."),
      newLogic: text(source.newLogic ?? source.new_logic, "No new-logic explanation was provided."),
      whatChanged: text(source.whatChanged ?? source.what_changed, "No change summary was provided."),
      whyHumanReview: text(
        source.whyHumanReview ?? source.why_human_review ?? source.reason ?? source.rationale,
        "No priority explanation was provided. Treating incomplete analysis conservatively."
      ),
      files: asArray(source.files, 50).map((file) => text(typeof file === "string" ? file : file && file.path)).filter(Boolean),
      evidence: asArray(source.evidence, 50).map(normalizeEvidence).filter(Boolean),
      diff: text(source.diff),
      confidence: Number.isFinite(Number(source.confidence)) ? Math.max(0, Math.min(1, Number(source.confidence))) : null,
      signals: stringArray(source.signals),
      policyReasons: stringArray(source.policyReasons ?? source.policy_reasons),
      contextWarnings: stringArray(source.contextWarnings ?? source.context_warnings)
    };
  }

  function normalizeReport(report) {
    const source = report && typeof report === "object" ? report : {};
    const rawChanges = source.changes ?? source.groups ?? source.items ?? source.review_items;
    const changes = asArray(rawChanges, 500).map(normalizeChange);
    changes.sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority));
    return {
      repository: text(source.repository),
      pullRequest: Number(source.pullRequest ?? source.pull_request) || null,
      title: text(source.title, "Pull request review"),
      url: text(source.url),
      baseSha: text(source.baseSha ?? source.base_sha),
      headSha: text(source.headSha ?? source.head_sha),
      generatedAt: text(source.generatedAt ?? source.generated_at),
      mode: source.mode === "replay" ? "replay" : "live",
      providers: source.providers && typeof source.providers === "object" ? source.providers : {},
      provenance: source.provenance && typeof source.provenance === "object" ? {
        classification: text(source.provenance.classification),
        explanations: text(source.provenance.explanations),
        note: text(source.provenance.note)
      } : {},
      coverage: source.coverage && typeof source.coverage === "object" ? {
        total: Number.isInteger(Number(source.coverage.total)) && Number(source.coverage.total) >= 0 ? Number(source.coverage.total) : changes.length,
        analyzed: Number.isInteger(Number(source.coverage.analyzed)) && Number(source.coverage.analyzed) >= 0 ? Number(source.coverage.analyzed) : changes.length,
        unanalysed: Number.isInteger(Number(source.coverage.unanalysed ?? source.coverage.unanalyzed)) && Number(source.coverage.unanalysed ?? source.coverage.unanalyzed) >= 0
          ? Number(source.coverage.unanalysed ?? source.coverage.unanalyzed)
          : 0
      } : { total: changes.length, analyzed: changes.length, unanalysed: 0 },
      context: source.context && typeof source.context === "object" ? source.context : {},
      display: source.display && typeof source.display === "object" ? source.display : {},
      changes
    };
  }

  function mergeDisplay(display, reportDisplay = {}) {
    const source = display && typeof display === "object" ? display : {};
    const policy = reportDisplay && typeof reportDisplay === "object" ? reportDisplay : {};
    return {
      visible: Object.fromEntries(PRIORITIES.map((p) => [p, source.visible?.[p] !== false])),
      expanded: Object.fromEntries(PRIORITIES.map((p) => [
        p,
        typeof source.expanded?.[p] === "boolean"
          ? source.expanded[p]
          : typeof policy.expanded?.[p] === "boolean"
            ? policy.expanded[p]
            : typeof policy[p] === "boolean"
              ? policy[p]
              : DEFAULT_DISPLAY.expanded[p]
      ])),
      showNativeDiff: source.showNativeDiff === true
    };
  }

  function el(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = String(content);
    return node;
  }

  function makeSection(label, value, modifier = "") {
    const section = el("section", `jrv-section ${modifier}`.trim());
    section.append(el("h4", "jrv-section__label", label), el("p", "jrv-section__text", value));
    return section;
  }

  function shortSha(sha) {
    return sha ? sha.slice(0, 8) : "unknown";
  }

  function makeFreshness(report, currentHeadSha) {
    if (!currentHeadSha || !report.headSha) {
      return { state: "unverified", label: `Head ${shortSha(report.headSha)} · freshness unverified` };
    }
    const matches = currentHeadSha.startsWith(report.headSha) || report.headSha.startsWith(currentHeadSha);
    return matches
      ? { state: "fresh", label: `Current at ${shortSha(report.headSha)}` }
      : { state: "stale", label: `Stale · analyzed ${shortSha(report.headSha)}, page ${shortSha(currentHeadSha)}` };
  }

  function provenanceText(report) {
    const classification = report.provenance.classification === "live-typesafe-api"
      ? report.mode === "replay" ? "Recorded Jev decisions" : "Live Jev decisions"
      : "Jev decision provenance unverified";
    const explanations = report.provenance.explanations === "prepared-copy"
      ? "prepared demo explanations"
      : report.provenance.explanations === "live-openai-api"
        ? "OpenAI explanations"
        : "explanation provenance unverified";
    return `${classification} · ${explanations}`;
  }

  function renderReview(container, rawReport, options = {}) {
    if (!container || typeof container.replaceChildren !== "function") {
      throw new TypeError("renderReview requires a DOM container.");
    }
    const report = normalizeReport(rawReport);
    const display = mergeDisplay(options.display, report.display);
    const onDisplayChange = typeof options.onDisplayChange === "function" ? options.onDisplayChange : () => {};
    const onPairingToken = typeof options.onPairingToken === "function" ? options.onPairingToken : null;
    const onRefresh = typeof options.onRefresh === "function" ? options.onRefresh : null;
    const onNativeDiffChange = typeof options.onNativeDiffChange === "function" ? options.onNativeDiffChange : () => {};
    const freshness = makeFreshness(report, text(options.currentHeadSha));
    if (freshness.state !== "fresh") display.showNativeDiff = true;
    const counts = Object.fromEntries(PRIORITIES.map((p) => [p, report.changes.filter((c) => c.priority === p).length]));
    const preparedCopy = report.provenance.explanations === "prepared-copy";

    container.replaceChildren();
    container.classList.add("jrv-shell");

    const header = el("header", "jrv-header");
    const brandRow = el("div", "jrv-brand-row");
    const brand = el("div", "jrv-brand");
    brand.append(el("span", "jrv-mark", "J"), el("span", "jrv-brand__name", "Jev-Reviewer"), el("span", "jrv-mode", report.mode));
    const actions = el("div", "jrv-actions");
    if (onRefresh) {
      const refresh = el("button", "jrv-button jrv-button--quiet", "Refresh");
      refresh.type = "button";
      refresh.addEventListener("click", onRefresh);
      actions.append(refresh);
    }
    if (typeof options.onNativeDiffChange === "function") {
      const nativeButton = el("button", "jrv-button", display.showNativeDiff ? "Hide code diff" : "View code diff");
      nativeButton.type = "button";
      nativeButton.addEventListener("click", () => {
        display.showNativeDiff = !display.showNativeDiff;
        nativeButton.textContent = display.showNativeDiff ? "Hide code diff" : "View code diff";
        onNativeDiffChange(display.showNativeDiff);
        onDisplayChange(display);
      });
      actions.append(nativeButton);
    }
    brandRow.append(brand, actions);

    const heading = el("div", "jrv-heading");
    heading.append(el("h2", "jrv-title", report.title));
    const freshnessNode = el("span", `jrv-freshness jrv-freshness--${freshness.state}`, freshness.label);
    freshnessNode.title = report.generatedAt ? `Generated ${report.generatedAt}` : "Generation time unavailable";
    heading.append(freshnessNode);
    header.append(brandRow, heading);

    const provenance = el("aside", `jrv-provenance${preparedCopy ? " jrv-provenance--prepared" : ""}`);
    const provenanceHeading = el("strong", "jrv-provenance__title", provenanceText(report));
    provenance.append(provenanceHeading);
    if (report.provenance.note) provenance.append(el("span", "jrv-provenance__note", report.provenance.note));
    header.append(provenance);

    const coverage = el("div", `jrv-coverage${report.coverage.unanalysed > 0 ? " jrv-coverage--partial" : ""}`);
    coverage.append(el("strong", "jrv-coverage__count", `${report.coverage.analyzed}/${report.coverage.total}`), document.createTextNode(" changes analyzed"));
    if (report.coverage.unanalysed > 0) coverage.append(document.createTextNode(` · ${report.coverage.unanalysed} require original-diff review`));
    const graphifyState = text(report.context.graphify);
    if (graphifyState && graphifyState !== "available") {
      const contextNote = el("span", "jrv-context-note", `Context warning: Graphify ${graphifyState}. ${text(report.context.note)}`.trim());
      coverage.append(contextNote);
    } else if (report.context.truncated === true) {
      coverage.append(el("span", "jrv-context-note", "Context warning: repository context was truncated."));
    }
    header.append(coverage);

    const toolbar = el("div", "jrv-toolbar");
    const filters = el("div", "jrv-filters");
    filters.setAttribute("aria-label", "Visible priorities");
    PRIORITIES.forEach((p) => {
      const button = el("button", `jrv-filter jrv-filter--${p.toLowerCase()}`);
      button.type = "button";
      button.dataset.priority = p;
      button.setAttribute("aria-pressed", String(display.visible[p]));
      button.append(el("span", "jrv-filter__dot"), el("span", "jrv-filter__name", p), el("span", "jrv-filter__count", counts[p]));
      button.addEventListener("click", () => {
        display.visible[p] = !display.visible[p];
        button.setAttribute("aria-pressed", String(display.visible[p]));
        container.querySelectorAll(`.jrv-card[data-priority="${p}"]`).forEach((card) => { card.hidden = !display.visible[p]; });
        onDisplayChange(display);
      });
      filters.append(button);
    });

    const settings = el("details", "jrv-settings");
    settings.append(el("summary", "jrv-settings__summary", "Display settings"));
    const settingsBody = el("div", "jrv-settings__body");
    const expandLabel = el("span", "jrv-settings__label", "Expand by default");
    const expandRow = el("div", "jrv-expand-row");
    PRIORITIES.forEach((p) => {
      const label = el("label", "jrv-checkbox");
      const input = el("input");
      input.type = "checkbox";
      input.checked = Boolean(display.expanded[p]);
      input.addEventListener("change", () => {
        display.expanded[p] = input.checked;
        container.querySelectorAll(`details.jrv-card[data-priority="${p}"]`).forEach((card) => { card.open = input.checked; });
        onDisplayChange(display);
      });
      label.append(input, document.createTextNode(` ${p}`));
      expandRow.append(label);
    });
    settingsBody.append(expandLabel, expandRow);
    if (onPairingToken) {
      const tokenLabel = el("label", "jrv-token-label", "Pairing token");
      const tokenRow = el("div", "jrv-token-row");
      const tokenInput = el("input", "jrv-token-input");
      tokenInput.type = "password";
      tokenInput.autocomplete = "off";
      tokenInput.placeholder = options.hasPairingToken ? "Token saved" : "Paste local pairing token";
      const save = el("button", "jrv-button jrv-button--small", "Save");
      save.type = "button";
      save.addEventListener("click", async () => {
        await onPairingToken(tokenInput.value.trim());
        tokenInput.value = "";
        tokenInput.placeholder = "Token saved";
        save.textContent = "Saved";
        setTimeout(() => { save.textContent = "Save"; }, 1200);
      });
      tokenRow.append(tokenInput, save);
      tokenLabel.append(tokenRow);
      settingsBody.append(tokenLabel);
    }
    settings.append(settingsBody);
    toolbar.append(filters, settings);
    header.append(toolbar);
    container.append(header);

    const list = el("div", "jrv-list");
    if (!report.changes.length) {
      const empty = el("div", "jrv-empty");
      empty.append(el("h3", "jrv-empty__title", "No semantic changes found"), el("p", "jrv-empty__copy", "The report is valid, but it contains no review cards."));
      list.append(empty);
    }

    report.changes.forEach((change) => {
      const card = el("details", `jrv-card jrv-card--${change.priority.toLowerCase()}`);
      card.dataset.priority = change.priority;
      card.dataset.changeId = change.id;
      card.open = Boolean(display.expanded[change.priority]);
      card.hidden = !display.visible[change.priority];
      const summary = el("summary", "jrv-card__summary");
      const priorityNode = el("span", `jrv-priority jrv-priority--${change.priority.toLowerCase()}`, change.priority);
      const titleWrap = el("span", "jrv-card__title-wrap");
      titleWrap.append(el("span", "jrv-card__title", change.title));
      const meta = [];
      if (change.files.length) meta.push(`${change.files.length} ${change.files.length === 1 ? "file" : "files"}`);
      if (meta.length) titleWrap.append(el("span", "jrv-card__meta", meta.join(" · ")));
      const chevron = el("span", "jrv-chevron");
      chevron.setAttribute("aria-hidden", "true");
      summary.append(priorityNode, titleWrap, chevron);
      card.append(summary);

      const body = el("div", "jrv-card__body");
      const comparison = el("div", "jrv-comparison");
      comparison.append(makeSection("Old logic", change.oldLogic, "jrv-section--old"), makeSection("New logic", change.newLogic, "jrv-section--new"));
      body.append(comparison, makeSection("What changed", change.whatChanged), makeSection("Human review question", change.whyHumanReview, "jrv-section--why"));

      if (change.files.length) {
        const files = el("div", "jrv-files");
        files.append(el("span", "jrv-files__label", "Affected files"));
        change.files.forEach((file) => files.append(el("code", "jrv-file", file)));
        body.append(files);
      }

      if (change.evidence.length || change.diff) {
        const evidence = el("details", "jrv-evidence");
        evidence.append(el("summary", "jrv-evidence__summary", `Supporting evidence${change.evidence.length ? ` (${change.evidence.length})` : ""}`));
        const evidenceBody = el("div", "jrv-evidence__body");
        const reviewNotes = [...change.policyReasons, ...change.contextWarnings];
        if (reviewNotes.length) {
          const notes = el("div", "jrv-review-notes");
          notes.append(el("strong", "jrv-review-notes__title", "Context and policy notes"));
          const noteList = el("ul", "jrv-review-notes__list");
          reviewNotes.forEach((note) => noteList.append(el("li", "jrv-review-notes__item", note)));
          notes.append(noteList);
          evidenceBody.append(notes);
        }
        change.evidence.forEach((item) => {
          const entry = el("div", "jrv-evidence__item");
          const line = item.startLine ? `:${item.startLine}${item.endLine && item.endLine !== item.startLine ? `–${item.endLine}` : ""}` : "";
          if (item.path) entry.append(el("code", "jrv-evidence__path", `${item.path}${line}`));
          if (item.snippet) entry.append(el("pre", "jrv-evidence__snippet", item.snippet));
          evidenceBody.append(entry);
        });
        if (change.diff) evidenceBody.append(el("pre", "jrv-evidence__snippet jrv-evidence__snippet--diff", change.diff));
        evidence.append(evidenceBody);
        body.append(evidence);
      } else if (change.policyReasons.length || change.contextWarnings.length) {
        const notes = el("div", "jrv-review-notes jrv-review-notes--standalone");
        notes.append(el("strong", "jrv-review-notes__title", "Context and policy notes"));
        const noteList = el("ul", "jrv-review-notes__list");
        [...change.policyReasons, ...change.contextWarnings].forEach((note) => noteList.append(el("li", "jrv-review-notes__item", note)));
        notes.append(noteList);
        body.append(notes);
      }
      card.append(body);
      list.append(card);
    });
    container.append(list);
    onNativeDiffChange(display.showNativeDiff);
    return { report, display, counts, freshness };
  }

  global.JevReviewerUI = {
    DEFAULT_DISPLAY,
    makeFreshness,
    mergeDisplay,
    normalizeChange,
    normalizeReport,
    provenanceText,
    renderReview
  };

  if (typeof module !== "undefined" && module.exports) module.exports = global.JevReviewerUI;
})(typeof globalThis !== "undefined" ? globalThis : this);
