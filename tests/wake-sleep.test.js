"use strict";

// core/wake-sleep.js (v5.5.2): hidden background work sleeps on the service worker's clock and
// holds a Web Lock; idle or visible tabs keep plain page timers.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

delete require.cache[require.resolve(path.join(__dirname, "../core/wake-sleep.js"))];
delete globalThis.OWEH;
globalThis.OWEH = {};
require("../core/wake-sleep.js");
const { createWakeSleep, WAKE_CHUNK_MS } = globalThis.OWEH.core.wakeSleep;

function fakeRuntime({ fail = false } = {}) {
  const sent = [];
  return {
    sent,
    id: "test",
    lastError: undefined,
    sendMessage(message, callback) {
      sent.push(message);
      setImmediate(() => callback(fail ? undefined : { ok: true, ms: message.ms }));
    }
  };
}

function fakeLocks() {
  const state = { requests: 0, held: 0 };
  return {
    state,
    request(_name, callback) {
      state.requests += 1;
      state.held += 1;
      return Promise.resolve(callback()).finally(() => { state.held -= 1; });
    }
  };
}

const never = () => {};
const flush = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  // ---- idle tab: plain page timer, no messages, no lock
  {
    const runtime = fakeRuntime();
    const locks = fakeLocks();
    let timers = 0;
    const wake = createWakeSleep({ isBusy: () => false, runtime, doc: { hidden: true }, locks, setTimer: (fn, ms) => { timers += 1; setTimeout(fn, Math.min(ms, 1)); } });
    await wake.sleep(1000);
    assert.equal(timers, 1);
    assert.equal(runtime.sent.length, 0, "an idle hidden tab never wakes the service worker");
    assert.equal(locks.state.requests, 0);
  }

  // ---- busy + visible: page timer, but the lock is held while busy
  {
    const runtime = fakeRuntime();
    const locks = fakeLocks();
    const wake = createWakeSleep({ isBusy: () => true, runtime, doc: { hidden: false }, locks, setTimer: (fn) => setImmediate(fn) });
    await wake.sleep(50);
    await flush();
    assert.equal(runtime.sent.length, 0);
    assert.equal(wake.lockHeld(), true, "busy work holds a Web Lock so Chrome does not freeze it");
    assert.equal(locks.state.held, 1);
  }

  // ---- busy + hidden: the service worker resolves the sleep even when page timers stall
  {
    const runtime = fakeRuntime();
    const wake = createWakeSleep({ isBusy: () => true, runtime, doc: { hidden: true }, locks: fakeLocks(), setTimer: never });
    await wake.sleep(0);
    assert.ok(runtime.sent.length >= 1);
    assert.equal(runtime.sent[0].type, "wakeAfter");
    assert.ok(runtime.sent[0].ms <= WAKE_CHUNK_MS && runtime.sent[0].ms > 0, "a hidden sleep waits at least the hidden minimum");
  }

  // ---- long hidden sleep is chunked below the service worker idle limit
  {
    const runtime = fakeRuntime();
    const wake = createWakeSleep({ isBusy: () => true, runtime, doc: { hidden: true }, locks: fakeLocks(), setTimer: never });
    const realNow = Date.now;
    let clock = realNow();
    Date.now = () => clock;
    runtime.sendMessage = (message, callback) => { runtime.sent.push(message); clock += message.ms; setImmediate(() => callback({ ok: true })); };
    await wake.sleep(50000);
    Date.now = realNow;
    assert.deepEqual(runtime.sent.map(message => message.ms), [20000, 20000, 10000]);
  }

  // ---- service worker unavailable: the page timer still resolves, no tight retry loop
  {
    const runtime = fakeRuntime({ fail: true });
    const wake = createWakeSleep({ isBusy: () => true, runtime, doc: { hidden: true }, locks: fakeLocks(), setTimer: (fn) => setTimeout(fn, 5) });
    await wake.sleep(5);
    await flush();
    assert.equal(runtime.sent.length, 1);
  }

  // ---- holdAwake: egg tabs are busy only while held; release drops the lock
  {
    const runtime = fakeRuntime();
    const locks = fakeLocks();
    const wake = createWakeSleep({ isBusy: () => false, runtime, doc: { hidden: true }, locks, setTimer: never });
    const release = wake.holdAwake();
    await flush();
    assert.equal(wake.isBusy(), true);
    assert.equal(wake.lockHeld(), true);
    await wake.sleep(10);
    assert.ok(runtime.sent.length >= 1);
    release();
    release();
    await flush();
    assert.equal(wake.isBusy(), false);
    assert.equal(wake.lockHeld(), false);
    assert.equal(locks.state.held, 0, "the Web Lock is released when the egg tab finishes");
  }

  // ---- the background answers wakeAfter with a capped timer
  const background = fs.readFileSync(path.join(__dirname, "../background.js"), "utf8");
  assert.match(background, /message\?\.type === "wakeAfter"/);
  assert.match(background, /WAKE_AFTER_MAX_MS = 20 \* 1000/);
  const eggTab = fs.readFileSync(path.join(__dirname, "../jobs/egg-turn-tab.js"), "utf8");
  assert.match(eggTab, /holdAwake\?\.\(\)/);
  assert.match(eggTab, /finally \{\s*release\(\);/);

  console.log("wake sleep tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
