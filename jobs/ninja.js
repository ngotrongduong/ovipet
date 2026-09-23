"use strict";

// Button: "Scan Ninja + Ads". Opens the OviPets profile, reads the Ninja Please and Ads post
// comments from the last 24 hours, and stores unique commenters that still need a friend
// request. It sends nothing — "Send friend requests" is its own button.
OWEH.register("job-ninja", helpers => {
  const { routes, ninjaService, sleep } = helpers;

  const job = OWEH.get("runner").api.createJob({
    owner: "ninja",
    label: "Scan Ninja + Ads",
    url: "https://ovipets.com/#!/OviPets",
    async run({ isCancelled, phase, status }) {
      if (!routes.isOviPetsChatPage()) {
        routes.navigateTo("#!/OviPets");
        const end = Date.now() + 10000;
        while (!routes.isOviPetsChatPage() && Date.now() < end) await sleep(100);
      }
      await helpers.waitForGameReady();
      phase("reading comments");
      const queue = await ninjaService.performNinjaChatScan();
      if (isCancelled() || !queue) return;
      status(`Scan Ninja + Ads: ${queue.length} new commenter(s) queued — press Send friend requests to send them`);
    }
  });

  return {
    workerHandlers: { ninja: job.workerHandler },
    buttons: job.buttons("#oweh-ninja-start", "#oweh-ninja-stop")
  };
});
