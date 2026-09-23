"use strict";

// Button: "Send friend requests". Sends one `friend_request` command per commenter queued by
// "Scan Ninja + Ads" that has not been asked before. Scans nothing.
OWEH.register("job-requests", helpers => {
  const { storageGet, storageSet, sleep, gameActions, settings } = helpers;

  const job = OWEH.get("runner").api.createJob({
    owner: "requests",
    label: "Send friend requests",
    url: "https://ovipets.com/#!/?src=pets&sub=overview",
    async run({ isCancelled, phase, status }) {
      const [queue, history] = await Promise.all([
        storageGet("owehChatQueue", []),
        storageGet("owehFriendRequestHistory", {})
      ]);
      const pending = queue.filter(target => !history[target.id]);
      if (!pending.length) {
        status(queue.length
          ? "Send friend requests: everyone in the queue was already asked"
          : "Send friend requests: the queue is empty — press Scan Ninja + Ads first");
        return;
      }
      let sent = 0;
      let errors = 0;
      for (let index = 0; index < pending.length; index += 1) {
        if (isCancelled()) break;
        const target = pending[index];
        phase(`sending ${index + 1}/${pending.length}`);
        status(`Send friend requests: ${index + 1}/${pending.length} — ${target.name}`);
        const result = await gameActions.requestFriend(target.id);
        history[target.id] = {
          at: Date.now(),
          name: target.name,
          status: result.ok ? "dispatched" : (result.reason || "failed")
        };
        if (result.ok) sent += 1; else errors += 1;
        // Saved after every send: a closed tab must never let the same person be asked twice.
        await storageSet({ owehFriendRequestHistory: history });
        await sleep(settings.DEFAULT_REQUEST_DELAY);
      }
      await storageSet({ owehFriendRequestHistory: history });
      status(`Send friend requests ${isCancelled() ? "stopped" : "finished"}: sent ${sent}, errors ${errors}`);
    }
  });

  return {
    workerHandlers: { requests: job.workerHandler },
    buttons: job.buttons("#oweh-requests-start", "#oweh-requests-stop")
  };
});
