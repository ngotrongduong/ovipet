"use strict";

(() => {
  if (!globalThis.OWEH) throw new Error("jobs/core.js must load before dom/friends.js");

  function friendLinks(root = document, hash = location.hash) {
    const links = [...root.querySelectorAll('fieldset.friends a.user.avatar[href], fieldset.friends a[href], [aria-label="Friends"] a[href]')];
    const ownId = String(hash || "").match(/[?&]usr=(\d+)/)?.[1];
    const seen = new Set();
    return links.map(link => {
      const href = link.getAttribute("href") || "";
      const avatarSrc = link.querySelector("img")?.getAttribute("src") || "";
      const id = href.match(/[?&]usr=(\d+)/)?.[1] || avatarSrc.match(/\/user\/(\d+)/)?.[1];
      if (!id || id === ownId || seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        name: link.getAttribute("title") || link.querySelector("img")?.getAttribute("title") || link.textContent.trim() || `User ${id}`,
        profile: `#!/?usr=${id}`,
        hatchery: `#!/?src=pets&sub=hatchery&usr=${id}`
      };
    }).filter(Boolean);
  }

  OWEH.dom = OWEH.dom || {};
  OWEH.dom.friends = Object.freeze({ friendLinks });
})();
