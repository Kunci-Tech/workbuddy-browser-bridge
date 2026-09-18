// Quick connection test for Browser Bridge
const browser = require("./client.js");

async function main() {
  console.log("Checking Browser Bridge status...");
  try {
    const status = await browser.getStatus();
    console.log("Bridge Server is running on port", status.port);
    console.log("Active agent:", status.agent);

    if (!status.connected) {
      console.log("\nChrome Extension is NOT yet connected for agent:", status.agent);
      console.log("Please open Chrome, go to chrome://extensions, enable 'Developer mode',");
      console.log("and click 'Load unpacked' pointing to the workbuddy-browser-bridge folder.");
      return;
    }

    console.log("Chrome Extension is CONNECTED!");
    console.log("\nFetching open Chrome tabs...");
    const tabs = await browser.getTabs();
    console.log(`Found ${tabs.length} open tab(s):\n`);

    tabs.forEach((t, i) => {
      console.log(`  [${i + 1}] ${t.title}`);
      console.log(`      URL: ${t.url} (ID: ${t.id})${t.active ? " [Active]" : ""}`);
    });

    console.log("\nEverything is ready! Browser Bridge can now control your Chrome!");

    // Show multi-agent info
    console.log("\n--- Multi-Agent Status ---");
    for (const [agentId, connected] of Object.entries(status.agents)) {
      console.log(`  ${agentId}: ${connected ? "connected" : "disconnected"}`);
    }
  } catch (err) {
    console.error("Error:", err.message);
  }
}

main();
