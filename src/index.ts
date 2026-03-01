import { loadConfig, API_BASE_URL } from "./config.js";
import { discoverInstagramUserId } from "./api.js";
import { runPipeline } from "./pipeline.js";
import { log, saveResults } from "./utils.js";

async function setup(): Promise<void> {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!accessToken) {
    log("Error: INSTAGRAM_ACCESS_TOKEN is not set. Check your .env file.");
    process.exit(1);
  }

  log("Discovering Instagram User ID from access token...");

  const result = await discoverInstagramUserId(API_BASE_URL, accessToken);

  if (!result) {
    log("Error: No Facebook Page with a linked Instagram Business Account found.");
    log("");
    log("Confirm the following:");
    log("  1. Your Facebook account owns at least one Facebook Page");
    log("  2. The Page is linked to an Instagram Business/Creator account");
    log("  3. Your access token has 'pages_show_list' and 'business_management' permissions");
    process.exit(1);
  }

  log("");
  log("Found!");
  log(`  Facebook Page: ${result.pageName} (ID: ${result.pageId})`);
  log(`  Instagram User ID: ${result.igUserId}`);
  log("");
  log("Add this to your .env file:");
  log(`  INSTAGRAM_USER_ID=${result.igUserId}`);
}

async function main(): Promise<void> {
  log("Instagram Graph API Data Collector starting...");

  const config = loadConfig();
  log(`Hashtags: ${config.hashtags.join(", ")}`);
  log(`Thresholds: minLikes=${config.thresholds.minLikes}, minComments=${config.thresholds.minComments}, topN=${config.thresholds.topN}`);

  const result = await runPipeline(config);

  // stdout に JSON 出力
  console.log(JSON.stringify(result, null, 2));

  // ファイル保存
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  await saveResults(result, `result-${ts}.json`);

  log("Done.");
}

const isSetup = process.argv.includes("--setup");

if (isSetup) {
  setup().catch((err) => {
    log(`Fatal error: ${err}`);
    process.exit(1);
  });
} else {
  main().catch((err) => {
    log(`Fatal error: ${err}`);
    process.exit(1);
  });
}
