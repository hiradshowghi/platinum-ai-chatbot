import {
  isLeadComplete,
  isServiceRequestType,
  isValidEmail,
  prepareLeadPayload,
  type LeadContextMessage,
  type LeadPayload,
} from "@/lib/lead";

export type ExpectedField =
  | "requestType"
  | "propertyType"
  | "backupType"
  | "installationType"
  | "location"
  | "generatorModel"
  | "issue"
  | "issueStarted"
  | "urgency"
  | "name"
  | "phone"
  | "email"
  | "address"
  | null;

export type CollectedLead = {
  requestType: string;
  propertyType: string;
  backupType: string;
  installationType: string;
  location: string;
  generatorModel: string;
  issue: string;
  issueStarted: string;
  urgency: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  locked: Partial<Record<Exclude<ExpectedField, null>, boolean>>;
};

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

const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
const PHONE_PATTERN =
  /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/;

const CASUAL_MESSAGE_PATTERN =
  /^(no[,.\s!]*(that'?s?\s*(it|all)|nothing else|nope|i'?m good|all good|that'?s everything|no thanks|nothing more|that is all|that is it)|that'?s?\s*(it|all|everything)|yes[,.\s!]*(that'?s?\s*(it|all)|nothing else)|ok(?:ay)?[,.\s!]*(thanks|that'?s?\s*(it|all))?|thanks|thank you|i\s+don'?t\s+need\s+(anything|anything else))[\s!.?]*$/i;

const BOT_FIELD_PATTERNS: Array<[RegExp, ExpectedField]> = [
  [/residential or commercial|home or business|for a home or a business|property type/i, "propertyType"],
  [
    /whole-home|whole home|essential circuit|backup power|backup type|backup goal/i,
    "backupType",
  ],
  [
    /new generator installation|new installation|replacement for an existing|replacement|install type/i,
    "installationType",
  ],
  [/city or location|what city|location is the installation|where.*located(?!.*address)/i, "location"],
  [/brand|model|generator model/i, "generatorModel"],
  [
    /describe the issue|what(?:'s| is) (?:the )?(?:issue|problem|happening)|issue description|not turning|not starting/i,
    "issue",
  ],
  [/when (?:did|does) the issue|when.*start|issue start/i, "issueStarted"],
  [
    /issue urgent|how urgent|how soon|wait a few days|can it wait|can wait|urgency level/i,
    "urgency",
  ],
  [
    /installation address|street address|address for the generator|address where the generator|service visit address|what is the address|your address/i,
    "address",
  ],
  [
    /what is your email|your email address|provide your email|email address\?/i,
    "email",
  ],
  [
    /phone number|provide your phone|your phone number|best number|number to reach|could you provide your phone/i,
    "phone",
  ],
  [
    /full name|may I have your name|may I have your full name|what is your name|provide your name|your name\b/i,
    "name",
  ],
  [/anything else|is there anything else|anything more|ready for review/i, null],
];

export function createEmptyCollectedLead(): CollectedLead {
  return {
    requestType: "",
    propertyType: "",
    backupType: "",
    installationType: "",
    location: "",
    generatorModel: "",
    issue: "",
    issueStarted: "",
    urgency: "",
    name: "",
    phone: "",
    email: "",
    address: "",
    locked: {},
  };
}

export function isCasualMessage(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (CASUAL_MESSAGE_PATTERN.test(trimmed)) return true;
  if (/^(yes|no|ok|okay)[\s!.?]*$/i.test(trimmed)) return true;
  return false;
}

function normalizeUrgencyAnswer(text: string): string {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (/\b(urgent|asap|immediately|right away|emergency|today)\b/.test(lower)) {
    return "Urgent";
  }
  if (/\b(can wait|few days|not urgent|no rush|whenever|routine)\b/.test(lower)) {
    return "Can wait a few days";
  }

  return trimmed;
}

function looksLikeUrgencyAnswer(text: string): boolean {
  const lower = text.trim().toLowerCase();
  return /\b(urgent|asap|can wait|few days|not urgent|no rush|whenever|routine|immediately|emergency)\b/.test(
    lower
  );
}

export function inferExpectedFieldFromBotMessage(
  botMessage: string
): ExpectedField {
  if (
    /issue urgent|how urgent|how soon|wait a few days|can it wait|can wait|urgency level/i.test(
      botMessage
    )
  ) {
    return "urgency";
  }

  const matches: ExpectedField[] = [];

  for (const [pattern, field] of BOT_FIELD_PATTERNS) {
    if (pattern.test(botMessage)) {
      matches.push(field);
    }
  }

  if (matches.length === 0) {
    return null;
  }

  // When a bot message mentions a prior field (e.g. "That email looks valid...")
  // and asks a new question, use the last matched field.
  return matches[matches.length - 1] ?? null;
}

function inferRequestTypeFromText(text: string): string {
  const trimmed = text.trim();
  if (QUICK_ACTION_REQUEST_TYPES[trimmed]) {
    return QUICK_ACTION_REQUEST_TYPES[trimmed];
  }

  const lower = text.toLowerCase();
  if (
    lower.includes("new generator quote") ||
    /(?:get|need|request|want|looking).{0,25}\bquote\b/.test(lower) ||
    (/\bquote\b/.test(lower) &&
      /want|looking|need|get|like|interested/.test(lower))
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
    /service visit|need service|not turning on|won'?t turn on|won'?t start|not starting|repair|broken|not working/.test(
      lower
    )
  ) {
    return "generator service/repair";
  }
  if (/install|buy a generator|new generator/.test(lower)) {
    return "new generator quote";
  }
  return "";
}

function lockField(
  lead: CollectedLead,
  field: Exclude<ExpectedField, null>,
  value: string
): CollectedLead {
  if (!value.trim()) return lead;
  return {
    ...lead,
    [field]: value.trim(),
    locked: { ...lead.locked, [field]: true },
  };
}

function applyValueForExpectedField(
  lead: CollectedLead,
  expectedField: ExpectedField,
  text: string
): CollectedLead {
  if (!expectedField || isCasualMessage(text)) {
    return lead;
  }

  if (lead.locked[expectedField]) {
    return lead;
  }

  const trimmed = text.trim();

  switch (expectedField) {
    case "propertyType":
      if (/\b(business|commercial)\b/i.test(trimmed)) {
        return lockField(lead, "propertyType", "Commercial");
      }
      if (/\b(home|house|residential)\b/i.test(trimmed)) {
        return lockField(lead, "propertyType", "Residential");
      }
      return lockField(lead, "propertyType", trimmed);
    case "backupType":
      if (/\bwhole[\s-]?home\b/i.test(trimmed) || /^whole$/i.test(trimmed)) {
        return lockField(lead, "backupType", "Whole-home backup");
      }
      if (/\bessential|circuit/i.test(trimmed)) {
        return lockField(lead, "backupType", "Essential circuits");
      }
      return lockField(lead, "backupType", trimmed);
    case "installationType":
      if (/\breplacement|replace/i.test(trimmed)) {
        return lockField(lead, "installationType", "Replacement");
      }
      if (/\bnew\b/i.test(trimmed)) {
        return lockField(lead, "installationType", "New installation");
      }
      return lockField(lead, "installationType", trimmed);
    case "location":
      return lockField(lead, "location", trimmed);
    case "generatorModel":
      if (/unknown|not sure|don'?t know/i.test(trimmed)) {
        return lockField(lead, "generatorModel", "Unknown");
      }
      return lockField(lead, "generatorModel", trimmed);
    case "issue":
      return lockField(lead, "issue", trimmed);
    case "issueStarted":
      return lockField(lead, "issueStarted", trimmed);
    case "urgency":
      return lockField(lead, "urgency", normalizeUrgencyAnswer(trimmed));
    case "name":
      return lockField(lead, "name", trimmed);
    case "phone": {
      const phone = trimmed.match(PHONE_PATTERN)?.[0] ?? trimmed;
      return lockField(lead, "phone", phone);
    }
    case "email": {
      const email = trimmed.match(EMAIL_PATTERN)?.[0];
      if (!email) return lead;
      return lockField(lead, "email", email);
    }
    case "address":
      return lockField(lead, "address", trimmed);
    default:
      return lead;
  }
}

function applyInitialIntent(lead: CollectedLead, text: string): CollectedLead {
  if (lead.locked.requestType) return lead;

  if (QUICK_ACTION_REQUEST_TYPES[text.trim()]) {
    return lockField(
      lead,
      "requestType",
      QUICK_ACTION_REQUEST_TYPES[text.trim()]
    );
  }

  const requestType = inferRequestTypeFromText(text);
  if (requestType && !isCasualMessage(text)) {
    return lockField(lead, "requestType", requestType);
  }

  return lead;
}

function mergeApiLeadIntoCollection(
  lead: CollectedLead,
  apiLead: LeadPayload | null | undefined
): CollectedLead {
  if (!apiLead) return lead;

  let next = { ...lead };
  const fields: Array<Exclude<ExpectedField, null>> = [
    "requestType",
    "name",
    "phone",
    "email",
    "address",
    "urgency",
  ];

  for (const field of fields) {
    const value = apiLead[field as keyof LeadPayload];
    if (typeof value === "string" && value.trim() && !next.locked[field]) {
      next = lockField(next, field, value);
    }
  }

  if (apiLead.message.trim() && !next.locked.issue) {
    next = lockField(next, "issue", apiLead.message);
  }

  return next;
}

export function applyUserTurnToCollectedLead(
  lead: CollectedLead,
  userText: string,
  expectedField: ExpectedField
): CollectedLead {
  const trimmed = userText.trim();
  if (!trimmed) return lead;

  let next = applyInitialIntent(lead, trimmed);

  if (isCasualMessage(trimmed)) {
    return next;
  }

  if (expectedField) {
    return applyValueForExpectedField(next, expectedField, trimmed);
  }

  if (
    !next.locked.urgency &&
    next.locked.issueStarted &&
    looksLikeUrgencyAnswer(trimmed)
  ) {
    return lockField(next, "urgency", normalizeUrgencyAnswer(trimmed));
  }

  if (!next.locked.issue && inferRequestTypeFromText(trimmed) === next.requestType) {
    return next;
  }

  return next;
}

export function applyBotTurnToCollectedLead(
  lead: CollectedLead,
  botMessage: string,
  apiLead?: LeadPayload | null
): CollectedLead {
  return mergeApiLeadIntoCollection(lead, apiLead ?? null);
}

export function collectedLeadToPayload(
  lead: CollectedLead,
  messages: LeadContextMessage[]
): LeadPayload {
  const userText = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");

  const messageParts = [
    lead.propertyType && `Property: ${lead.propertyType}`,
    lead.backupType && `Backup: ${lead.backupType}`,
    lead.installationType && `Installation: ${lead.installationType}`,
    lead.location && `Location: ${lead.location}`,
    lead.generatorModel && `Generator: ${lead.generatorModel}`,
    lead.issue && `Issue: ${lead.issue}`,
    lead.issueStarted && `Started: ${lead.issueStarted}`,
    lead.urgency && `Urgency: ${lead.urgency}`,
  ].filter(Boolean);

  const message =
    messageParts.join(" | ") ||
    userText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !QUICK_ACTION_INTENTS.includes(line))
      .join(" | ")
      .slice(0, 600);

  return prepareLeadPayload({
    requestType: lead.requestType,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    address: lead.address,
    urgency: lead.urgency,
    message,
    conversationSummary: messages
      .slice(-12)
      .map(
        (m) =>
          `${m.role === "user" ? "Customer" : "Assistant"}: ${m.content}`
      )
      .join("\n")
      .slice(0, 2500),
  });
}

export function hasSubmittableIntentFromCollection(lead: CollectedLead): boolean {
  return !!lead.requestType;
}

export function resolveLeadFromCollection(
  lead: CollectedLead,
  messages: LeadContextMessage[],
  apiLead?: LeadPayload | null
): LeadPayload | null {
  const merged = mergeApiLeadIntoCollection(lead, apiLead ?? null);
  if (!hasSubmittableIntentFromCollection(merged)) {
    return null;
  }

  const payload = collectedLeadToPayload(merged, messages);

  if (
    !isServiceRequestType(payload.requestType) &&
    payload.email &&
    !isValidEmail(payload.email)
  ) {
    return null;
  }

  return isLeadComplete(payload, messages) ? payload : null;
}

export function applyReviewCorrection(
  lead: CollectedLead,
  text: string
): CollectedLead {
  let next = { ...lead };
  const trimmed = text.trim();

  const email = trimmed.match(EMAIL_PATTERN)?.[0];
  if (email && isValidEmail(email)) {
    next = lockField(next, "email", email);
  }

  const phone = trimmed.match(PHONE_PATTERN)?.[0];
  if (phone) {
    next = lockField(next, "phone", phone);
  }

  const nameMatch = trimmed.match(
    /\b(?:my name is|name is|change name to)\s+([A-Za-z][A-Za-z'. -]{1,60})/i
  );
  if (nameMatch?.[1]) {
    next = lockField(next, "name", nameMatch[1]);
  }

  const addressMatch = trimmed.match(
    /\b(?:my address is|address is|change address to)\s+(.+)/i
  );
  if (addressMatch?.[1]) {
    next = lockField(next, "address", addressMatch[1]);
  }

  if (/\b(issue is|problem is|change issue to)\b/i.test(trimmed)) {
    next = lockField(next, "issue", trimmed);
  }

  return next;
}
