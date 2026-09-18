// Agent Registry: Central configuration for all supported AI agents.
// To add a new agent, simply add an entry here — no core code changes needed.

const AGENTS = {
  workbuddy: {
    id: "workbuddy",
    name: "WorkBuddy AI",
    shortName: "WorkBuddy",
    description: "Your AI-powered workspace companion for research, coding, and automation.",
    port: 8766,
    wsUrl: "ws://127.0.0.1:8766",
    httpUrl: "http://127.0.0.1:8766",
    branding: {
      primaryColor: "#1D9E75",
      secondaryColor: "#5DCAA5",
      accentGradient: "linear-gradient(135deg, #1D9E75 0%, #5DCAA5 50%, #A0E8C5 100%)",
      cursorGradient: "linear-gradient(135deg, #1D9E75 0%, #5DCAA5 50%, #A0E8C5 100%)",
      dark: "#04342C",
      light: "#E1F5EE"
    },
    systemPrompt: `You are WorkBuddy AI Browser Bridge, an intelligent agent that controls the user's Chrome browser through the Browser Bridge extension. You can navigate, click, type, take screenshots, tag elements, and interact with web pages using natural language commands.

Your capabilities:
- Navigate to URLs and switch between tabs
- Click elements by text, selector, badge ID, or coordinates
- Type text into form fields
- Capture screenshots of the active tab
- Tag interactive elements with Set-of-Mark (SoM) badges for precise clicking
- Detect anti-bot challenges (Cloudflare, reCAPTCHA, 2FA) and alert the user
- Record and replay macro workflows
- Evaluate JavaScript in the page context

When the user asks you to do something on a web page:
1. First, understand what page they're on (use getDOM or screenshot)
2. Tag elements if you need to identify clickable targets
3. Execute the action (click, type, navigate)
4. Verify the result with a screenshot or DOM extraction
5. Report back what happened

Always be cautious with high-stakes actions (delete, pay, transfer). The extension has guardrails that will pause and ask for human confirmation on these.`,
    guide: {
      quickStart: "Ask WorkBuddy to navigate, click, type, or screenshot any web page. Use 'tag elements' to see clickable targets as numbered badges.",
      examples: [
        "Go to google.com and search for 'best coffee in Jakarta'",
        "Take a screenshot of this page",
        "Tag all buttons on this page and click badge 3",
        "Navigate to my Google Ads dashboard and screenshot the campaigns table",
        "Fill in the contact form with: name='John', email='john@example.com'"
      ],
      tips: [
        "Use 'tag elements' before clicking to get precise badge IDs",
        "Mention 'screenshot' to capture what's on screen",
        "For forms, list the field names and values you want to fill",
        "The extension will pause on CAPTCHA/2FA — solve it and it auto-resumes"
      ]
    },
    capabilities: [
      "navigate", "click", "clickBadge", "type", "screenshot",
      "tagElements", "clearTags", "getDOM", "evaluate",
      "detectChallenge", "toggleOmnibar", "startRecording", "stopRecording"
    ]
  },

  antigravity: {
    id: "antigravity",
    name: "Antigravity IDE",
    shortName: "Antigravity",
    description: "Gemini-powered visual AI browser controller with native CDP and animated laser cursor.",
    port: 8765,
    wsUrl: "ws://127.0.0.1:8765",
    httpUrl: "http://127.0.0.1:8765",
    branding: {
      primaryColor: "#38bdf8",
      secondaryColor: "#818cf8",
      accentGradient: "linear-gradient(135deg, #38bdf8 0%, #818cf8 50%, #c084fc 100%)",
      cursorGradient: "linear-gradient(135deg, #38bdf8 0%, #818cf8 50%, #c084fc 100%)",
      dark: "#0C447C",
      light: "#E6F1FB"
    },
    systemPrompt: `You are Antigravity Browser Bridge, a visual AI browser controller for Antigravity IDE (Gemini). You control Chrome via native Chrome DevTools Protocol (CDP) with an animated laser cursor, Set-of-Mark tagging, and safety guardrails.`,
    guide: {
      quickStart: "Use the bridge client library to control Chrome. Tag elements, click badges, type text, and capture screenshots.",
      examples: [
        "browser.focusTab({ urlContains: 'ads.google.com' })",
        "browser.tagElements() then browser.clickBadge(4)",
        "browser.click({ text: 'Save', actionLabel: 'Saving settings' })",
        "browser.screenshot() to capture the page"
      ],
      tips: [
        "Tag elements first for deterministic clicking",
        "Use actionLabel for visual cursor context",
        "Guardrails auto-activate on delete/pay/transfer actions"
      ]
    },
    capabilities: [
      "navigate", "click", "clickBadge", "type", "screenshot",
      "tagElements", "clearTags", "getDOM", "evaluate",
      "detectChallenge", "toggleOmnibar", "startRecording", "stopRecording"
    ]
  }
};

// Default agent when extension first loads
const DEFAULT_AGENT = "workbuddy";

// Get agent config by ID
function getAgent(agentId) {
  return AGENTS[agentId] || AGENTS[DEFAULT_AGENT];
}

// Get all agent IDs
function getAgentIds() {
  return Object.keys(AGENTS);
}

// Get default agent
function getDefaultAgent() {
  return AGENTS[DEFAULT_AGENT];
}

// Export for both browser and Node.js contexts
if (typeof module !== "undefined" && module.exports) {
  module.exports = { AGENTS, DEFAULT_AGENT, getAgent, getAgentIds, getDefaultAgent };
}
