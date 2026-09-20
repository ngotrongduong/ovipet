"use strict";

(function attachNinjaDualChatPolicy(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.OwehNinjaCandidatePolicy = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function buildPolicy() {
  const TARGET_CONVERSATIONS = Object.freeze(["Ninja please", "Ads post"]);
  const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

  function normalizeConversationTitle(value) {
    return String(value == null ? "" : value)
      .trim()
      .replace(/\s+/g, " ")
      .toLocaleLowerCase();
  }

  const TARGET_TITLE_KEYS = new Set(
    TARGET_CONVERSATIONS.map(normalizeConversationTitle)
  );

  function isTargetConversationTitle(value) {
    return TARGET_TITLE_KEYS.has(normalizeConversationTitle(value));
  }

  function normalizeUserId(value) {
    if (value == null) return "";
    const id = String(value).trim();
    return /^\d+$/.test(id) ? id : "";
  }

  function toTimestampMs(value) {
    if (value instanceof Date) {
      const ms = value.getTime();
      return Number.isFinite(ms) ? ms : NaN;
    }

    if (typeof value === "number") {
      if (!Number.isFinite(value)) return NaN;
      // Accept Unix seconds as well as milliseconds.
      return value > 0 && value < 10_000_000_000 ? value * 1000 : value;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return NaN;

      if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
        return toTimestampMs(Number(trimmed));
      }

      const parsed = Date.parse(trimmed);
      return Number.isFinite(parsed) ? parsed : NaN;
    }

    return NaN;
  }

  function isWithinRollingWindow(value, nowMs, windowMs = DEFAULT_WINDOW_MS) {
    const at = toTimestampMs(value);
    const now = toTimestampMs(nowMs);

    if (!Number.isFinite(at) || !Number.isFinite(now)) return false;
    if (!Number.isFinite(windowMs) || windowMs <= 0) return false;

    return at <= now && at >= now - windowMs;
  }

  function normalizeIdSet(value) {
    if (!value) return new Set();

    if (value instanceof Set) {
      return new Set(
        Array.from(value, normalizeUserId).filter(Boolean)
      );
    }

    if (Array.isArray(value)) {
      return new Set(value.map(normalizeUserId).filter(Boolean));
    }

    if (typeof value === "object") {
      return new Set(
        Object.keys(value)
          .filter((key) => Boolean(value[key]))
          .map(normalizeUserId)
          .filter(Boolean)
      );
    }

    return new Set();
  }

  function defaultConversationTitleOf(conversation) {
    if (!conversation || typeof conversation !== "object") return "";
    return conversation.title || conversation.name || conversation.label || "";
  }

  function defaultUserIdOf(message) {
    if (!message || typeof message !== "object") return "";
    return (
      message.userId ||
      message.userID ||
      message.userid ||
      message.authorId ||
      message.authorID ||
      ""
    );
  }

  function defaultTimestampOf(message) {
    if (!message || typeof message !== "object") return NaN;
    return (
      message.at ??
      message.timestamp ??
      message.time ??
      message.createdAt ??
      message.created_at ??
      NaN
    );
  }

  async function scanDualConversationCandidates(options) {
    if (!options || typeof options !== "object") {
      throw new TypeError("options is required");
    }

    const {
      listConversations,
      openConversation,
      readMessages,
      getSentIds,
      sentIds,
      now = Date.now(),
      windowMs = DEFAULT_WINDOW_MS,
      conversationTitleOf = defaultConversationTitleOf,
      userIdOf = defaultUserIdOf,
      timestampOf = defaultTimestampOf,
      onSourceError,
    } = options;

    if (typeof listConversations !== "function") {
      throw new TypeError("listConversations must be a function");
    }
    if (typeof readMessages !== "function") {
      throw new TypeError("readMessages must be a function");
    }

    const nowMs = toTimestampMs(now);
    if (!Number.isFinite(nowMs)) {
      throw new TypeError("now must be a valid timestamp");
    }

    const persistedSentIds = normalizeIdSet(
      typeof getSentIds === "function" ? await getSentIds() : sentIds
    );

    const conversations = (await listConversations()) || [];
    const byTitle = new Map();

    for (const conversation of conversations) {
      const title = conversationTitleOf(conversation);
      const key = normalizeConversationTitle(title);
      if (!TARGET_TITLE_KEYS.has(key)) continue;

      // Keep the first matching conversation for a title. Position/order is irrelevant.
      if (!byTitle.has(key)) {
        byTitle.set(key, { conversation, title: String(title || "").trim() });
      }
    }

    const candidatesById = new Map();
    const stats = {
      targetCount: TARGET_CONVERSATIONS.length,
      foundCount: 0,
      scannedCount: 0,
      messageCount: 0,
      recentMessageCount: 0,
      skippedAlreadySent: 0,
      invalidUserId: 0,
      invalidTimestamp: 0,
      duplicateCandidateHits: 0,
      sourceErrors: 0,
    };
    const missingTitles = [];
    const sourceErrors = [];

    for (const canonicalTitle of TARGET_CONVERSATIONS) {
      const key = normalizeConversationTitle(canonicalTitle);
      const hit = byTitle.get(key);

      if (!hit) {
        missingTitles.push(canonicalTitle);
        continue;
      }

      stats.foundCount += 1;

      try {
        if (typeof openConversation === "function") {
          await openConversation(hit.conversation, canonicalTitle);
        }

        const messages = (await readMessages(hit.conversation, canonicalTitle)) || [];
        stats.scannedCount += 1;
        stats.messageCount += messages.length;

        for (const message of messages) {
          const userId = normalizeUserId(userIdOf(message));
          if (!userId) {
            stats.invalidUserId += 1;
            continue;
          }

          const messageAt = toTimestampMs(timestampOf(message));
          if (!Number.isFinite(messageAt)) {
            stats.invalidTimestamp += 1;
            continue;
          }

          if (!isWithinRollingWindow(messageAt, nowMs, windowMs)) {
            continue;
          }

          stats.recentMessageCount += 1;

          if (persistedSentIds.has(userId)) {
            stats.skippedAlreadySent += 1;
            continue;
          }

          const existing = candidatesById.get(userId);
          if (existing) {
            stats.duplicateCandidateHits += 1;
            existing.lastSeenAt = Math.max(existing.lastSeenAt, messageAt);
            existing.firstSeenAt = Math.min(existing.firstSeenAt, messageAt);
            existing.sources.add(canonicalTitle);
            continue;
          }

          candidatesById.set(userId, {
            userId,
            firstSeenAt: messageAt,
            lastSeenAt: messageAt,
            sources: new Set([canonicalTitle]),
          });
        }
      } catch (error) {
        stats.sourceErrors += 1;
        const record = {
          title: canonicalTitle,
          message: error && error.message ? error.message : String(error),
        };
        sourceErrors.push(record);

        if (typeof onSourceError === "function") {
          try {
            await onSourceError(record, error);
          } catch (_) {
            // Diagnostic hooks must never abort the remaining conversation scan.
          }
        }
      }
    }

    const candidates = Array.from(candidatesById.values())
      .map((candidate) => ({
        userId: candidate.userId,
        firstSeenAt: candidate.firstSeenAt,
        lastSeenAt: candidate.lastSeenAt,
        sources: Array.from(candidate.sources),
      }))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt || a.userId.localeCompare(b.userId));

    return {
      candidates,
      candidateIds: candidates.map((candidate) => candidate.userId),
      missingTitles,
      sourceErrors,
      stats,
    };
  }

  return Object.freeze({
    TARGET_CONVERSATIONS,
    DEFAULT_WINDOW_MS,
    normalizeConversationTitle,
    normalizeUserId,
    toTimestampMs,
    isWithinRollingWindow,
    isTargetConversationTitle,
    scanDualConversationCandidates,
  });
});
