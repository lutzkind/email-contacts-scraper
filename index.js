const fs = require("fs");
const config = require("./src/config");
const { createStore } = require("./src/store");
const { createEmailEnricher } = require("./src/email-enricher");
const { createWorker } = require("./src/worker");
const { createApp } = require("./src/server");

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.exportsDir, { recursive: true });

const store = createStore(config);
const emailEnricher = createEmailEnricher({ config });
const worker = createWorker({ store, config, emailEnricher });
const app = createApp({ store, config, emailEnricher });

const server = app.listen(config.port, config.host, () => {
  worker
    .start()
    .then(() => {
      console.log(
        `email-contacts-scraper listening on http://${config.host}:${config.port}`
      );
    })
    .catch((error) => {
      console.error("Failed to start worker:", error);
      server.close(() => {
        process.exitCode = 1;
      });
    });
});
