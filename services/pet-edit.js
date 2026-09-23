"use strict";

// Live pet-profile edit actions: rename, enclosure move, gender read and the manual
// Save/Name buttons. Direct UI-dispatcher commands are tried first where confirmed; the visible
// Edit-tab button/dialog flows remain the fallback. content.js composes it once with explicit
// dependencies; selectors here are unchanged from content.js (docs/dom-audit-2026-09-17.md).
(() => {
  if (!globalThis.OWEH) throw new Error("jobs/core.js must load before services/pet-edit.js");

  function createPetEdit(deps) {
    const {
      sleep, setStatus, storageGet, storageSet, getPageLoadDelayMs,
      sendGameCommand, fastMovePetToEnclosure, currentPetId,
      findTab, isTabActive, readOverviewValue, readPet,
      suggestedPetName, normalizeEnclosureLabel, NEWBORN_ENCLOSURES
    } = deps;

    function buttonWithText(text) {
      return [...document.querySelectorAll("main button, [role=dialog] button")]
        .find(button => button.textContent.trim() === text && button.offsetParent !== null) || null;
    }

    async function waitForButtonText(text, timeout = 5000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const button = buttonWithText(text);
        if (button) return button;
        await sleep(150);
      }
      return null;
    }

    async function openTab(name, timeout = 8000) {
      const tab = findTab(name);
      if (!tab) return false;
      if (!isTabActive(tab)) tab.querySelector("a")?.click();
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        if (isTabActive(findTab(name))) return true;
        await sleep(100);
      }
      return isTabActive(findTab(name));
    }

    // Confirmed flow (docs/dom-audit-2026-09-17.md #3): Rename lives on the Edit tab, opens a
    // generic confirm dialog with input[name="Name"] (no id) and Ok/Cancel buttons.
    async function waitForRenameInput(timeout = 5000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const input = [...document.querySelectorAll('[role="dialog"] input[name="Name"]')]
          .find(el => el.offsetParent !== null);
        if (input) return input;
        await sleep(100);
      }
      return null;
    }

    function visibleDialog(matcher = null) {
      return [...document.querySelectorAll('[role="dialog"]')]
        .find(dialog => dialog.offsetParent !== null && (!matcher || matcher.test(dialog.textContent || ""))) || null;
    }

    function dialogButton(dialog, text) {
      return [...(dialog?.querySelectorAll("button") || [])]
        .find(button => button.textContent.trim() === text && button.offsetParent !== null) || null;
    }

    async function renamePet(pet, desiredName = suggestedPetName(pet)) {
      if (!pet || !desiredName) return { changed: false, reason: "missing-name" };
      if (pet.name === desiredName) return { changed: false, reason: "already-named" };
      const isUnnamed = /^Unnamed$/i.test(String(pet.name || "").trim());
      // Confirmed live 2026-09-18: Rename calls
      // ui_action_cmdExec('pet_rename', `PetID=${id}`, form), with input[name="Name"].
      // Use that same rendered UI dispatcher first; retain the inspected button flow below
      // as a compatibility fallback if the game changes or the dispatcher is unavailable.
      if (!isUnnamed) {
        const direct = await sendGameCommand("pet_rename", pet.id, { Name: desiredName });
        if (direct.ok) return { changed: true, name: desiredName, fast: true };
      }
      // A live newly hatched pet exposes Name in the profile Actions block and keeps its
      // Enclosure select disabled until naming succeeds. Older named pets expose Rename from
      // Edit. Support both flows, preferring the directly visible Name action.
      let renameButton = isUnnamed ? await waitForButtonText("Name", 5000) : buttonWithText("Name");
      if (!renameButton) {
        if (!(await openTab("Edit"))) return { changed: false, reason: "missing-edit-tab" };
        renameButton = await waitForButtonText("Rename", 5000);
      }
      if (!renameButton) return { changed: false, reason: "missing-rename-button" };
      renameButton.click();
      const input = await waitForRenameInput();
      if (!input) return { changed: false, reason: "missing-rename-input" };
      input.value = desiredName;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      const dialog = input.closest('[role="dialog"]');
      const ok = dialogButton(dialog, "Ok");
      if (!ok) return { changed: false, reason: "missing-rename-confirm" };
      ok.click();
      const end = Date.now() + 8000;
      while (Date.now() < end) {
        const displayed = document.querySelector("main h3 .ui-section-title")?.textContent
          || document.querySelector("main h3")?.textContent
          || "";
        if (!visibleDialog() && displayed.includes(desiredName)) return { changed: true, name: desiredName };
        await sleep(150);
      }
      return { changed: !visibleDialog(), name: desiredName, reason: "unverified" };
    }

    async function applySuggestedName() {
      const pet = readPet();
      const suggestion = pet ? suggestedPetName(pet) : null;
      if (!suggestion) return setStatus("Open a pet profile to get a naming suggestion first");
      const result = await renamePet(pet, suggestion);
      setStatus(result.changed
        ? `Renamed to "${suggestion}"`
        : result.reason === "already-named" ? `Already named "${suggestion}"` : `Rename failed: ${result.reason}`);
    }

    async function saveCurrentPet() {
      const pet = readPet();
      if (!pet) return setStatus("Open a pet profile with visible Colors first");
      const pets = await storageGet("owehPets", {});
      const previous = pets[pet.id];
      // Overview can be saved before lazy Pedigree content is mounted. Preserve an already
      // verified pedigree in that manual-save case; never invent verification from an empty
      // current panel. A breeding index refresh will still replace stale records normally.
      if (pet.pedigreeVerified !== true && previous?.pedigreeVerified === true) {
        pet.pedigreeVerified = true;
        pet.ancestors = [...(previous.ancestors || [])];
        pet.pedigree = [...(previous.pedigree || [])];
        pet.parentIds = [...(previous.parentIds || [])];
      }
      pets[pet.id] = { ...(previous || {}), ...pet };
      // petDbMerge upserts per record: write only this pet, so a stale copy of the rest of the
      // database cannot overwrite what a worker tab saved meanwhile.
      await storageSet({ owehPets: { [pet.id]: pets[pet.id] } });
      const suggestion = suggestedPetName(pet);
      const suffix = suggestion ? ` — suggested name: ${suggestion}` : "";
      setStatus(`Saved ${pet.name} (${Object.keys(pets).length} pets indexed)${suffix}`);
    }

    function petGenderFromOverview() {
      return readOverviewValue("Gender")
        || document.querySelector('section#overview img[title="Male"], section#overview img[title="Female"]')?.title
        || "";
    }

    async function waitForPetGender(timeout = 8000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const gender = petGenderFromOverview().trim();
        if (/^(?:Female|Male)$/i.test(gender)) return gender;
        await sleep(150);
      }
      return petGenderFromOverview().trim();
    }

    function enclosureSelect() {
      const selects = [...document.querySelectorAll('section#edit select, main select')];
      return document.querySelector('section#edit select[name="Enclosure"]')
        || selects.find(select => /enclosure/i.test(select.name || "") || /enclosure/i.test(select.id || ""))
        || selects.find(select => {
          const fieldsetText = select.closest("fieldset")?.textContent || "";
          const labelText = select.closest("label")?.textContent || "";
          return /\bEnclosure\b/i.test(`${fieldsetText} ${labelText}`);
        })
        || selects.find(select => NEWBORN_ENCLOSURES.some(target =>
          [...select.options].some(option => normalizeEnclosureLabel(option.textContent) === normalizeEnclosureLabel(target))
        ))
        || null;
    }

    async function waitForEnclosureSelect(timeout = 10000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const select = enclosureSelect();
        if (select && select.offsetParent !== null && !select.disabled) return select;
        await sleep(150);
      }
      return null;
    }

    function enclosureOption(select, target) {
      const wanted = normalizeEnclosureLabel(target);
      return [...(select?.options || [])].find(option => normalizeEnclosureLabel(option.textContent) === wanted) || null;
    }

    async function movePetToEnclosure(target) {
      const fast = await fastMovePetToEnclosure(currentPetId(), target);
      if (fast.moved) return fast;
      if (!(await openTab("Edit"))) return { moved: false, reason: "missing-edit-tab" };
      let select = await waitForEnclosureSelect();
      if (!select) return { moved: false, reason: "missing-enclosure-select" };
      let option = enclosureOption(select, target);
      if (!option) return { moved: false, reason: `missing-option:${target}` };
      if (select.value === option.value) return { moved: false, alreadyThere: true };
      const selectedValue = option.value;
      select.value = selectedValue;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      const end = Date.now() + 10000;
      while (Date.now() < end) {
        await sleep(200);
        select = enclosureSelect();
        if (!select) continue;
        option = enclosureOption(select, target);
        if (option && select.value === option.value) {
          await sleep(Math.max(500, getPageLoadDelayMs()));
          return { moved: true };
        }
      }
      return { moved: false, reason: "selection-not-confirmed" };
    }

    return Object.freeze({
      buttonWithText, waitForButtonText, openTab, renamePet, applySuggestedName, saveCurrentPet,
      waitForPetGender, movePetToEnclosure
    });
  }

  OWEH.services = OWEH.services || {};
  OWEH.services.petEdit = Object.freeze({ createPetEdit });
})();
