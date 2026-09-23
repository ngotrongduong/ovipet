"use strict";

// Friend discovery that never mutates the game: saving the visible friends list as the sweep
// queue, copying the blacklist as CSV, and the Ninja please / Ads post commenter scan (writes
// only owehChatQueue; sending requests stays in jobs/requests.js). content.js composes it once
// with explicit dependencies.
(() => {
  if (!globalThis.OWEH) throw new Error("jobs/core.js must load before services/friend-directory.js");

  const CHAT_WINDOW_MS = 24 * 60 * 60 * 1000;

  function createFriendDirectory(deps) {
    const {
      storageGet, storageSet, sleep, setStatus, getPageLoadDelayMs, getOwnUserId,
      getBlacklist, writeClipboard, friendLinks, chatDom
    } = deps;
    const { NINJA_CHAT_TARGETS, parseCommentTime, chatPostContainer, collectChatCandidates } = chatDom;

    async function openCompleteFriendsList() {
      const avatarCount = document.querySelectorAll("fieldset.friends a.user.avatar[href]").length;
      const closeButton = [...document.querySelectorAll("button")]
        .some(candidate => /^Close$/i.test(candidate.textContent.trim()) && candidate.offsetParent !== null);
      const hasCompleteList = avatarCount >= 50 || (closeButton && avatarCount > 0);
      if (hasCompleteList) return;
      const button = [...document.querySelectorAll("main button")]
        .find(candidate => /^Friends(?:\s*\(\d+\))?$/i.test(candidate.textContent.trim()));
      if (!button) return;
      button.click();
      const end = Date.now() + 10000;
      while (Date.now() < end) {
        if (document.querySelectorAll("fieldset.friends a.user.avatar[href]").length >= 50) return;
        await sleep(200);
      }
    }

    async function scanFriends() {
      await openCompleteFriendsList();
      const found = friendLinks();
      if (!found.length) return setStatus("No numeric friend profiles found on this page");
      const blacklist = await getBlacklist();
      const friends = found.filter(friend => !blacklist[friend.id]);
      const skipped = found.length - friends.length;
      await storageSet({ owehFriendQueue: friends, owehSweep: { active: false, index: 0, maxFriends: friends.length } });
      setStatus(`Found ${friends.length} friend(s) — full list saved; cooldowns will be skipped${skipped ? ` (${skipped} blacklisted friend(s) excluded)` : ""}`);
    }

    // Export only a copied CSV; no external API/OAuth connection is required.
    async function copyBlacklistCsv() {
      const [blacklist, queue] = await Promise.all([
        getBlacklist(),
        storageGet("owehFriendQueue", [])
      ]);
      const names = Object.fromEntries((queue || []).map(friend => [String(friend.id), friend.name || ""]));
      const rows = Object.entries(blacklist || {}).map(([id, entry = {}]) => [
        id,
        names[String(id)] || "",
        entry.reason || "",
        Number.isFinite(Number(entry.at)) && Number(entry.at) > 0 ? new Date(Number(entry.at)).toISOString() : ""
      ]);
      if (!rows.length) {
        setStatus("Blacklist is empty — nothing to copy");
        return;
      }
      const quote = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
      const csv = [
        "user_id,name,reason,blacklisted_at",
        ...rows.map(row => row.map(quote).join(","))
      ].join("\n");
      try {
        await writeClipboard(csv);
        setStatus(`Copied ${rows.length} blacklisted friend(s) as CSV`);
      } catch {
        setStatus("Could not copy automatically — clipboard access was denied");
      }
    }

    async function expandRecentChatComments(title) {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const container = chatPostContainer(title);
        if (!container) return false;
        const button = [...container.querySelectorAll("button")]
          .find(candidate => /Show Previous Comments/i.test(candidate.textContent.trim()) && candidate.offsetParent !== null);
        if (!button) return true;
        const before = container.querySelectorAll("li").length;
        button.click();
        await sleep(Math.max(getPageLoadDelayMs(), 1000));
        const updated = chatPostContainer(title);
        if (!updated) return false;
        const after = updated.querySelectorAll("li").length;
        if (after <= before) return true;
        const oldest = [...updated.querySelectorAll(".comments li")]
          .map(parseCommentTime).filter(Number.isFinite).sort((a, b) => a - b)[0];
        if (oldest && Date.now() - oldest >= CHAT_WINDOW_MS) return true;
      }
      return true;
    }

    async function performNinjaChatScan() {
      const ownId = String(await storageGet("owehOwnUserId", getOwnUserId() || "") || "");
      const history = await storageGet("owehFriendRequestHistory", {});
      const containers = [];
      const scanned = [];
      const missing = [];

      for (const title of NINJA_CHAT_TARGETS) {
        let container = chatPostContainer(title);
        if (!container) {
          missing.push(title);
          continue;
        }
        setStatus(`Loading recent ${title} comments...`);
        await expandRecentChatComments(title);
        container = chatPostContainer(title);
        if (!container) {
          missing.push(title);
          continue;
        }
        containers.push(container);
        scanned.push(title);
      }

      if (!containers.length) {
        setStatus(`Could not find ${NINJA_CHAT_TARGETS.join(" or ")} chat posts`);
        return null;
      }

      const queue = collectChatCandidates(containers, {
        now: Date.now(), windowMs: CHAT_WINDOW_MS, ownId, history
      });
      await storageSet({ owehChatQueue: queue });
      const missingText = missing.length ? `; not found: ${missing.join(", ")}` : "";
      setStatus(`Found ${queue.length} unique commenter(s) from ${scanned.join(" + ")} in the last 24 hours${missingText}`);
      return queue;
    }

    return Object.freeze({ scanFriends, copyBlacklistCsv, performNinjaChatScan });
  }

  OWEH.services = OWEH.services || {};
  OWEH.services.friendDirectory = Object.freeze({ CHAT_WINDOW_MS, createFriendDirectory });
})();
