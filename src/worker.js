const { writeArtifacts } = require("./exporters");

function createWorker({ store, config, emailEnricher }) {
  let timer = null;
  let busy = false;

  return {
    async start() {
      timer = setInterval(() => {
        this.tick().catch((error) => {
          console.error("Worker tick failed:", error);
        });
      }, config.workerPollMs);
      timer.unref?.();
    },

    stop() {
      if (timer) {
        clearInterval(timer);
      }
    },

    async tick() {
      if (busy) {
        return;
      }
      const job = store.claimNextJob();
      if (!job) {
        return;
      }
      busy = true;
      try {
        const results = await emailEnricher.scrapeUrls(job.targets, job.options || {});
        store.replaceJobResults(job.id, results);
        const artifacts = writeArtifacts(store, config, job.id);
        const hasOk = results.some((entry) => entry.status === "ok");
        store.finalizeJob(
          job.id,
          hasOk ? "completed" : "partial",
          hasOk ? "Completed." : "Completed with no contacts found.",
          artifacts
        );
      } catch (error) {
        store.failJob(job.id, error.message);
      } finally {
        busy = false;
      }
    },
  };
}

module.exports = {
  createWorker,
};
