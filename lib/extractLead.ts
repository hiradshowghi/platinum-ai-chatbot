import {
  isLeadComplete,
  isServiceRequestType,
  isValidEmail,
  prepareLeadPayload,
  type LeadContextMessage,
  type LeadPayload,
} from "@/lib/lead";

export type ChatMessage = LeadContextMessage;

const QUICK_ACTION_INTENTS = [
  "New Generator Quote",
  "Generator Service / Repair",
  "Maintenance Booking",
  "Speak to Someone",
];

const QUICK_ACTION_REQUEST_TYPES: Record<string, string> = {
  "New Generator Quote": "new generator quote",
  "Generator Service / Repair": "generator service/repair",
  "Maintenance Booking": "maintenance booking",
  "Speak to Someone": "speak to someone",
};

const ACTIONABLE_INTENT_PATTERN =
  /(?:generator quote|get a quote|request a quote|quote for|maintenance booking|schedule maintenance|speak to someone|call me back|callback|generator service|service\/\s*repair|need repair|needs repair|won'?t start|not starting|install a generator|buy a generator|need a generator|follow[- ]?up|talk to someone|book service|repair my)/i;

const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
const PHONE_PATTERN =
  /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/;
const POSTAL_PATTERN = /\b[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d\b/i;

function getUserText(messages: ChatMessage[]): string {
  return messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");
}

function getUserMessages(messages: ChatMessage[]) {
  return messages.filter((m) => m.role === "user");
}

/** True when the customer wants quote, service, repair, maintenance, callback, or follow-up. */
export function hasSubmittableIntent(messages: ChatMessage[]): boolean {
  const userMessages = getUserMessages(messages);
  if (userMessages.length === 0) return false;

  if (
    userMessages.some((m) => QUICK_ACTION_INTENTS.includes(m.content.trim()))
  ) {
    return true;
  }

  const userText = getUserText(messages);
  if (!ACTIONABLE_INTENT_PATTERN.test(userText)) {
    return false;
  }

  const generalOnlyQuestions = [
    /^do you sell generators\??$/i,
    /^do you service\b/i,
    /^how much does\b/i,
    /^how much is\b/i,
    /^what areas do you\b/i,
    /^are you a generac dealer\??$/i,
    /^what do you (?:sell|offer)\??$/i,
  ];

  const onlyGeneral =
    userMessages.length === 1 &&
    generalOnlyQuestions.some((pattern) =>
      pattern.test(userMessages[0].content.trim())
    );

  return !onlyGeneral;
}

function inferRequestTypeFromText(text: string): string {
  const lower = text.toLowerCase();
  const trimmed = text.trim();

  if (QUICK_ACTION_REQUEST_TYPES[trimmed]) {
    return QUICK_ACTION_REQUEST_TYPES[trimmed];
  }

  if (
    lower.includes("new generator quote") ||
    /(?:get|need|request).{0,20}quote/.test(lower)
  ) {
    return "new generator quote";
  }
  if (
    lower.includes("maintenance booking") ||
    /schedule maintenance/.test(lower)
  ) {
    return "maintenance booking";
  }
  if (
    lower.includes("speak to someone") ||
    /call me back|callback|talk to someone|follow[- ]?up/.test(lower)
  ) {
    return "speak to someone";
  }
  if (
    lower.includes("generator service") ||
    lower.includes("service / repair") ||
    /repair|won'?t start|not starting|broken|not working/.test(lower)
  ) {
    return "generator service/repair";
  }
  if (/install|buy a generator|new generator/.test(lower)) {
    return "new generator quote";
  }

  return "";
}

function inferRequestTypeFromMessages(messages: ChatMessage[]): string {
  for (const message of getUserMessages(messages)) {
    const requestType = inferRequestTypeFromText(message.content);
    if (requestType) {
      return requestType;
    }
  }
  return "";
}

function inferUrgency(text: string): string {
  const lower = text.toLowerCase();
  if (
    /urgent|emergency|asap|right away|no power|burning smell|sparking/.test(
      lower
    )
  ) {
    return "urgent";
  }
  if (/soon|this week|as soon as/.test(lower)) {
    return "soon";
  }
  return "";
}

function extractEmail(userMessages: ChatMessage[]): string {
  for (const message of [...userMessages].reverse()) {
    const match = message.content.match(EMAIL_PATTERN)?.[0] ?? "";
    if (isValidEmail(match)) {
      return match;
    }
  }
  return "";
}

function extractPhone(userMessages: ChatMessage[]): string {
  for (const message of [...userMessages].reverse()) {
    const phone = message.content.match(PHONE_PATTERN)?.[0];
    if (phone) {
      return phone;
    }
  }
  return "";
}

function looksLikeAddress(line: string): boolean {
  if (line.length < 8) return false;
  if (EMAIL_PATTERN.test(line) || PHONE_PATTERN.test(line)) return false;
  return (
    /\d+\s+[A-Za-z0-9.\s-]+/.test(line) ||
    POSTAL_PATTERN.test(line) ||
    /,\s*[A-Za-z]/.test(line)
  );
}

function extractAddress(userMessages: ChatMessage[]): string {
  for (const message of [...userMessages].reverse()) {
    const lines = message.content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of [...lines].reverse()) {
      if (looksLikeAddress(line)) {
        return line;
      }
    }
  }
  return "";
}

function extractName(userMessages: ChatMessage[]): string {
  for (const message of [...userMessages].reverse()) {
    const content = message.content.trim();

    if (
      EMAIL_PATTERN.test(content) ||
      PHONE_PATTERN.test(content) ||
      looksLikeAddress(content) ||
      QUICK_ACTION_INTENTS.includes(content)
    ) {
      continue;
    }

    const patterns = [
      /\b(?:my name is|i am|i'm|this is)\s+([A-Za-z][A-Za-z'. -]{1,60})/i,
      /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})$/,
      /^([A-Za-z]+(?:\s+[A-Za-z]+){1,2})$/,
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match?.[1]) {
        return match[1].trim();
      }
    }
  }
  return "";
}

function extractIssueDescription(userMessages: ChatMessage[]): string {
  const issuePatterns = [
    /won'?t start/i,
    /not starting/i,
    /no power/i,
    /error code/i,
    /making noise/i,
    /repair/i,
    /broken/i,
    /not working/i,
  ];

  for (const message of [...userMessages].reverse()) {
    const content = message.content.trim();
    if (
      issuePatterns.some((pattern) => pattern.test(content)) &&
      content.length > 12
    ) {
      return content;
    }
  }

  const lastSubstantial = [...userMessages]
    .reverse()
    .find((m) => m.content.trim().length > 15);

  return lastSubstantial?.content.trim() ?? "";
}

function buildConversationSummary(messages: ChatMessage[]): string {
  return messages
    .slice(-12)
    .map(
      (m) => `${m.role === "user" ? "Customer" : "Assistant"}: ${m.content}`
    )
    .join("\n")
    .slice(0, 2500);
}

function extractSalesMessage(userMessages: ChatMessage[]): string {
  const parts = userMessages
    .map((m) => m.content.trim())
    .filter(
      (content) =>
        content.length > 2 &&
        !EMAIL_PATTERN.test(content) &&
        !PHONE_PATTERN.test(content) &&
        !QUICK_ACTION_INTENTS.includes(content) &&
        !looksLikeAddress(content)
    );

  return parts.join(" | ").slice(0, 600);
}

function extractFromConversation(messages: ChatMessage[]): LeadPayload {
  const userMessages = getUserMessages(messages);
  const userText = getUserText(messages);
  const requestType = inferRequestTypeFromMessages(messages);
  const message = isServiceRequestType(requestType)
    ? extractIssueDescription(userMessages)
    : extractSalesMessage(userMessages);

  return {
    requestType,
    name: extractName(userMessages),
    phone: extractPhone(userMessages),
    email: extractEmail(userMessages),
    address: extractAddress(userMessages),
    urgency: inferUrgency(userText),
    message,
    conversationSummary: buildConversationSummary(messages),
  };
}

function mergeLeads(
  fromConversation: LeadPayload,
  fromApi: LeadPayload
): LeadPayload {
  return {
    requestType: fromApi.requestType || fromConversation.requestType,
    name: fromApi.name || fromConversation.name,
    phone: fromApi.phone || fromConversation.phone,
    email: fromApi.email || fromConversation.email,
    address: fromApi.address || fromConversation.address,
    urgency: fromApi.urgency || fromConversation.urgency,
    message: fromApi.message || fromConversation.message,
    conversationSummary:
      fromApi.conversationSummary || fromConversation.conversationSummary,
  };
}

/**
 * Returns a complete lead when actionable intent exists and all required
 * fields for the lead type are present in the conversation.
 */
export function resolveReadyLead(
  messages: ChatMessage[],
  apiLead?: LeadPayload | null
): LeadPayload | null {
  if (!hasSubmittableIntent(messages)) {
    return null;
  }

  const fromConversation = extractFromConversation(messages);
  const merged = prepareLeadPayload(
    apiLead ? mergeLeads(fromConversation, apiLead) : fromConversation
  );

  if (!merged.requestType) {
    return null;
  }

  if (
    !isServiceRequestType(merged.requestType) &&
    merged.email &&
    !isValidEmail(merged.email)
  ) {
    return null;
  }

  return isLeadComplete(merged, messages) ? merged : null;
}

/** @deprecated Use resolveReadyLead */
export function extractLeadFromMessages(
  messages: ChatMessage[],
  apiLead?: LeadPayload | null
): LeadPayload | null {
  return resolveReadyLead(messages, apiLead);
}

export function toChatMessages(
  messages: Array<{ role: "user" | "assistant"; content: string }>
): ChatMessage[] {
  return messages.map((message) => ({
    role: message.role === "assistant" ? "bot" : "user",
    content: message.content,
  }));
}
