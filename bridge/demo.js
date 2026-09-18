// Browser Bridge Demo: Multi-Agent Visual Browser Control
const browser = require("./client.js");

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runDemo() {
  console.log("Starting Browser Bridge Demo...\n");

  // 1. Show agent info
  console.log("1. Fetching agent registry...");
  const agentInfo = await browser.getAgentInfo();
  console.log(`   Found ${agentInfo.agents.length} agents:`);
  agentInfo.agents.forEach(a => {
    console.log(`   - ${a.name} (port ${a.port}, ${a.connected ? "connected" : "disconnected"})`);
  });
  await sleep(500);

  // 2. Get system prompt
  console.log("\n2. Fetching WorkBuddy system prompt...");
  const prompt = await browser.getSystemPrompt();
  console.log(`   Agent: ${prompt.agentName}`);
  console.log(`   Capabilities: ${prompt.capabilities.join(", ")}`);
  console.log(`   Prompt length: ${prompt.systemPrompt.length} chars`);
  await sleep(500);

  // 3. Check status
  console.log("\n3. Checking bridge status...");
  const status = await browser.getStatus();
  console.log("   Status:", JSON.stringify(status));
  if (!status.connected) {
    console.log("\n   Extension not connected. Load the extension in Chrome first!");
    return;
  }

  // 4. List tabs
  console.log("\n4. Listing open Chrome tabs...");
  const tabs = await browser.getTabs();
  console.log(`   Found ${tabs.length} tab(s)`);
  tabs.slice(0, 5).forEach((t, i) => {
    console.log(`   [${i + 1}] ${t.title}`);
  });

  // 5. Tag elements
  console.log("\n5. Tagging interactive elements with Set-of-Mark...");
  const tags = await browser.tagElements();
  console.log(`   Tagged ${tags.taggedCount} elements`);

  // 6. Clear tags
  console.log("\n6. Clearing SoM badges...");
  await browser.clearTags();
  console.log("   Badges cleared");

  console.log("\nDemo completed successfully!");
}

runDemo().catch(err => console.error("Demo Error:", err.message));
