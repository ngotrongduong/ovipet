"use strict";

(() => {
  if (!globalThis.OWEH?.dom?.routes) throw new Error("dom/routes.js must load before dom/chat.js");

  const { userIdFromLink } = OWEH.dom.routes;
  const NINJA_CHAT_TARGETS = Object.freeze(["Ninja please", "Ads post"]);

  function normalizeChatTitle(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
  }

  function parseCommentTime(element, now = Date.now()) {
    const timeElement = element.querySelector("abbr.age[title], time, [datetime], [data-time], [data-timestamp]");
    const raw = timeElement?.getAttribute("datetime") || timeElement?.getAttribute("data-time")
      || timeElement?.getAttribute("data-timestamp") || timeElement?.getAttribute("title") || "";
    const absolute = Date.parse(raw);
    if (Number.isFinite(absolute)) return absolute;
    const text = (timeElement?.textContent || element.textContent || "").trim().toLowerCase();
    // Live OviPets labels include "a minute ago", "an hour ago" and "a few seconds ago".
    if (/\b(?:just now|a few seconds ago)\b/.test(text)) return now;
    const match = text.match(/(\d+|an?)\s+(second|minute|hour)s?\s+ago/);
    if (!match) return null;
    const units = { second: 1000, minute: 60000, hour: 3600000 };
    const amount = /^an?$/.test(match[1]) ? 1 : Number(match[1]);
    return now - amount * units[match[2]];
  }

  function postIdentityRoot(element) {
    if (!element || typeof element.cloneNode !== "function") return element;
    const clone = element.cloneNode(true);
    for (const comments of clone.querySelectorAll?.(".comments") || []) comments.remove?.();
    return clone;
  }

  function textWithoutComments(element) {
    const identity = postIdentityRoot(element);
    return String(identity?.innerText || identity?.textContent || "");
  }

  function hasExactTitleSignal(element, normalizedTitle) {
    const identity = postIdentityRoot(element);
    const selectors = "h1, h2, h3, h4, h5, h6, .event-title, .title, .subject, legend";
    for (const node of identity?.querySelectorAll?.(selectors) || []) {
      if (normalizeChatTitle(node.textContent) === normalizedTitle) return true;
      if (normalizeChatTitle(node.getAttribute?.("title")) === normalizedTitle) return true;
    }
    for (const image of identity?.querySelectorAll?.("img[title], img[alt]") || []) {
      const title = normalizeChatTitle(image.getAttribute?.("title"));
      const alt = normalizeChatTitle(image.getAttribute?.("alt"));
      if (title === normalizedTitle || alt === normalizedTitle) return true;
      if (normalizedTitle === "ads post" && (title === "ads" || alt === "ads")) return true;
    }
    return false;
  }

  function containsTitlePhrase(text, normalizedTitle) {
    const normalizedText = normalizeChatTitle(text);
    if (!normalizedText || !normalizedTitle) return false;
    return normalizedText.includes(normalizedTitle);
  }

  function chatPostContainer(title, root = document) {
    const normalizedTitle = normalizeChatTitle(title);
    if (!normalizedTitle) return null;

    // Keep the audited Ninja contract as the strongest signal.
    if (normalizedTitle === "ninja please") {
      const image = root.querySelector?.('main td.event img[title="Ninja"], main td.event img[src*="/Ninja."]');
      if (image) return image.closest("td.event");
    }
    const candidates = [...(root.querySelectorAll?.("main td.event") || [])];
    const exact = candidates.find(element => hasExactTitleSignal(element, normalizedTitle));
    if (exact) return exact;

    // Ninja's legacy body text is an audited fallback and does not rely on title wording.
    if (normalizedTitle === "ninja please") {
      const legacy = candidates.find(element => /Welcome all ninjas/i.test(textWithoutComments(element))
        && element.querySelector?.(".comments"));
      if (legacy) return legacy;
    }

    // Final fallback examines only the post body/header, excluding comments. This lets
    // "Ads post" survive harmless OviPets markup changes without a comment containing the
    // same words being mistaken for the target post.
    return candidates.find(element => element.querySelector?.(".comments")
      && containsTitlePhrase(textWithoutComments(element), normalizedTitle)) || null;
  }

  function ninjaChatContainer(root = document) {
    return chatPostContainer("Ninja please", root);
  }

  function collectChatCandidates(containers, { now, windowMs, ownId = "", history = {} } = {}) {
    const current = Number(now);
    const window = Number(windowMs);
    if (!Number.isFinite(current) || !Number.isFinite(window)) {
      throw new Error("collectChatCandidates requires finite now and windowMs");
    }
    const candidates = new Map();
    const list = Array.isArray(containers) ? containers : [containers];
    for (const container of list.filter(Boolean)) {
      for (const comment of container.querySelectorAll(".comments li")) {
        const timestamp = parseCommentTime(comment, current);
        if (!timestamp || current - timestamp > window || current < timestamp) continue;
        const commentText = comment.querySelector(".comment")?.textContent?.trim() || "";
        if (/\b(?:no|not)\s+(?:new\s+)?(?:friend|fr)\s*(?:requests?|reqs?)?\b/i.test(commentText)) continue;
        const link = comment.querySelector('.poster a.user[href], .avatar a.user[href]');
        const id = link && userIdFromLink(link);
        if (!id || id === String(ownId || "") || history[id]) continue;
        const existing = candidates.get(id);
        if (existing && existing.timestamp >= timestamp) continue;
        candidates.set(id, {
          id,
          name: link.getAttribute("title") || link.querySelector("img")?.getAttribute("title") || link.textContent.trim() || `User ${id}`,
          profile: `#!/?usr=${id}`,
          timestamp
        });
      }
    }
    return [...candidates.values()].sort((a, b) => b.timestamp - a.timestamp);
  }

  function collectNinjaCandidates(container, options = {}) {
    return collectChatCandidates([container], options);
  }

  OWEH.dom.chat = Object.freeze({
    NINJA_CHAT_TARGETS,
    normalizeChatTitle,
    parseCommentTime,
    chatPostContainer,
    ninjaChatContainer,
    collectChatCandidates,
    collectNinjaCandidates
  });
})();
