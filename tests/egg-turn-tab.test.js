"use strict";

// UI-only Turn Egg runner. Retryable incorrect species answers cause another real Turn Egg
// click (up to three answer attempts); only the explicit no-longer-turnable Error is terminal.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

async function run({
  hash = "#!/?src=pets&sub=profile&usr=555&pet=9001",
  owned = true, button = true, clickSucceeds = true, dialog = false,
  retryableRejectOnce = false, retryableRejectCount = 0, stuckReject = false, terminalReject = false,
  gameReady = true, petId = "9001"
} = {}) {
  const clock = { now: 1000000 };
  const log = { requests: [], clicks: 0, statuses: [], species: [], hiddenCommands: [] };
  const page = { button, dialogPolls: dialog ? 3 : 0, rejected: false, rejectionCount: 0, terminal: false };
  const turnButton = {
    click() {
      log.clicks += 1;
      if (clickSucceeds) {
        if (dialog) page.dialogPolls = Math.max(page.dialogPolls, 3);
        else if (!retryableRejectOnce && !retryableRejectCount && !stuckReject && !terminalReject) page.button = false;
      }
    }
  };
  const helpers = {
    sleep: async ms => {
      clock.now += ms;
      if (page.dialogPolls > 0) {
        page.dialogPolls -= 1;
        if (page.dialogPolls === 0 && clickSucceeds) page.button = false;
      }
      await Promise.resolve();
    },
    setStatus: text => log.statuses.push(text),
    waitForGameReady: async () => gameReady,
    sendGameCommand: async (...args) => { log.hiddenCommands.push(args); return { ok: true }; },
    runtimeRequest: async message => {
      log.requests.push(message);
      if (message.type === "eggTabAssignment") return owned ? { ok: true, eggId: "9001", batchId: "b" } : { ok: false, reason: "not-owned" };
      return { ok: true };
    },
    routes: { currentPetId: () => petId },
    profileDom: { getProfileTurnButton: () => (page.button ? turnButton : null) }
  };
  const speciesModule = {
    api: {
      dialogOpen: () => page.dialogPolls > 0,
      checkRejected: async () => {
        if (terminalReject && !page.terminal && log.clicks >= 1) {
          page.terminal = true; log.species.push("terminal");
          return { rejected: true, terminal: true, reason: "egg-can-no-longer-be-turned" };
        }
        if (stuckReject && log.clicks >= 1) {
          log.species.push("stuck");
          return { rejected: true, terminal: false, stuck: true, reason: "species-error-stuck" };
        }
        const retryLimit = retryableRejectCount || (retryableRejectOnce ? 1 : 0);
        if (retryLimit && page.rejectionCount < retryLimit && log.clicks >= page.rejectionCount + 1) {
          page.rejectionCount += 1; page.rejected = true; page.button = true; log.species.push("retryable");
          return { rejected: true, terminal: false, reason: "species-incorrect" };
        }
        if (retryLimit && page.rejectionCount >= retryLimit && log.clicks >= retryLimit + 1) page.button = false;
        return false;
      },
      monitor: async () => { log.species.push("monitor"); },
      settleTurnResult: async result => { log.species.push(`settle:${result?.ok}`); }
    }
  };
  const sandbox = vm.createContext({
    console: { error() {} }, Promise, Date: { now: () => clock.now }, Object, Array, Set, Map, JSON, Math, Number, String, Boolean, RegExp,
    location: { hash }, setTimeout: callback => { callback(); return 0; }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "jobs", "core.js"), "utf8"), sandbox);
  sandbox.OWEH.register("species-answer", () => speciesModule);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "jobs", "egg-turn-tab.js"), "utf8"), sandbox);
  sandbox.OWEH.boot(helpers);
  for (let i = 0; i < 300 && !log.requests.some(request => request.type === "eggTabResult") && (owned || i < 20); i += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
  await new Promise(resolve => setImmediate(resolve));
  return { log, result: log.requests.find(request => request.type === "eggTabResult") };
}

(async () => {
  {
    const { log, result } = await run();
    assert.equal(log.clicks, 1);
    assert.equal(log.hiddenCommands.length, 0);
    assert.equal(result.state, "turned");
    assert.ok(log.species.includes("settle:true"));
  }
  {
    const { log, result } = await run({ owned: false });
    assert.equal(log.clicks, 0); assert.equal(result, undefined);
  }
  {
    const { log } = await run({ hash: "#!/?src=pets&sub=overview" });
    assert.equal(log.requests.length, 0);
  }
  {
    const { result } = await run({ button: false });
    assert.equal(result.state, "already");
  }
  {
    const { log, result } = await run({ clickSucceeds: false });
    assert.equal(log.clicks, 3);
    assert.equal(result.state, "abandoned");
    assert.equal(result.reason, "ui-turn-timeout");
  }
  {
    const { log, result } = await run({ dialog: true });
    assert.ok(log.species.includes("monitor"));
    assert.equal(result.state, "turned");
  }
  {
    const { log, result } = await run({ retryableRejectOnce: true });
    assert.ok(log.species.includes("retryable"));
    assert.equal(log.clicks, 2, "retryable incorrect answer must click the real Turn Egg button again");
    assert.equal(result.state, "turned");
  }
  {
    const { log, result } = await run({ retryableRejectCount: 3 });
    assert.equal(log.clicks, 4, "three wrong species answers must not strand the tab at the old 3-attempt cap");
    assert.equal(result.state, "turned");
  }
  {
    const { log, result } = await run({ stuckReject: true });
    assert.ok(log.species.includes("stuck"));
    assert.equal(result.state, "abandoned", "a blocking species Error overlay must close cleanly instead of becoming a leftover");
    assert.equal(result.reason, "species-error-stuck");
  }
  {
    const { log, result } = await run({ terminalReject: true });
    assert.ok(log.species.includes("terminal"));
    assert.equal(log.clicks, 1, "terminal Error must never retry Turn Egg");
    assert.equal(result.state, "exhausted");
    assert.equal(result.reason, "egg-can-no-longer-be-turned");
  }
  {
    const { log, result } = await run({ gameReady: false });
    assert.equal(log.clicks, 0); assert.equal(result.reason, "game-not-ready");
    const wrong = await run({ petId: "1234" });
    assert.equal(wrong.result.reason, "wrong-page");
  }
  console.log("egg turn tab UI-click tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
