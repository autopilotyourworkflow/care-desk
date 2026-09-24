/**
 * Prints lib/fixtures/sample-results.json. Regenerate after any change to the pipeline or the data:
 *   npx tsx lib/fixtures/build-samples.ts > lib/fixtures/sample-results.json
 * The builder itself lives in ./samples-build.ts, so tests/fixtures.test.ts can re-run it and catch a stale file.
 * Every person, order and message is fictional.
 */
import { buildSamples } from "./samples-build";

buildSamples()
  .then((file) => console.log(JSON.stringify(file, null, 2)))
  .catch((err) => {
    console.error(err);
    throw err;
  });
