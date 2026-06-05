export type LeadPayload = {
  requestType: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  urgency: string;
  message: string;
  conversationSummary: string;
};

export type LeadContextMessage = {
  role: "user" | "bot";
  content: string;
};

export function isServiceRequestType(requestType: string): boolean {
  const normalized = requestType.toLowerCase();
  return normalized.includes("service") || normalized.includes("repair");
}

export function isSalesQuoteRequestType(requestType: string): boolean {
  const normalized = requestType.toLowerCase();
  if (isServiceRequestType(requestType)) {
    return false;
  }
  return (
    normalized.includes("quote") ||
    normalized.includes("install") ||
    /buy|new generator/.test(normalized)
  );
}

export function isValidEmail(email: string): boolean {
  const trimmed = email.trim();
  if (!trimmed) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed);
}

export function normalizeLeadPayload(raw: Record<string, unknown>): LeadPayload {
  return {
    requestType: String(raw.requestType ?? "").trim(),
    name: String(raw.name ?? "").trim(),
    phone: String(raw.phone ?? "").trim(),
    email: String(raw.email ?? "").trim(),
    address: String(raw.address ?? "").trim(),
    urgency: String(raw.urgency ?? "").trim(),
    message: String(raw.message ?? "").trim(),
    conversationSummary: String(raw.conversationSummary ?? "").trim(),
  };
}

export function prepareLeadPayload(lead: LeadPayload): LeadPayload {
  const prepared = { ...lead };

  if (!prepared.message && prepared.conversationSummary) {
    prepared.message = prepared.conversationSummary.slice(0, 600);
  }

  if (!prepared.conversationSummary) {
    prepared.conversationSummary = prepared.message;
  }

  return prepared;
}

function getUserText(messages: LeadContextMessage[]): string {
  return messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");
}

export function hasSalesQuoteQualification(
  messages: LeadContextMessage[],
  lead: LeadPayload
): boolean {
  const text = [
    getUserText(messages),
    lead.message,
    lead.address,
  ]
    .join(" ")
    .toLowerCase();

  const homeOrBusiness =
    /\b(home|house|business|commercial|residential)\b/.test(text);
  const backup =
    /\b(whole[\s-]?home|essential|circuit|backup|partial|\bwhole\b)/.test(
      text
    );
  const installType =
    /\b(new install|new installation|replacement|replace|replacing)\b/.test(
      text
    ) || /\bnew\b/.test(text);
  const hasLocation =
    lead.address.trim().length > 5 ||
    /location:\s*.+/i.test(lead.message) ||
    /\b(ottawa|toronto|kingston|london|hamilton|belleville|peterborough|barrie|oshawa|ontario)\b/i.test(
      text
    );

  return homeOrBusiness && backup && installType && hasLocation;
}

export function hasServiceQualification(
  messages: LeadContextMessage[],
  lead: LeadPayload
): boolean {
  const text = [getUserText(messages), lead.message].join(" ").toLowerCase();
  const hasIssue =
    lead.message.trim().length >= 8 ||
    /\b(won'?t start|not starting|error|noise|repair|broken|alarm|fault|issue|problem)\b/.test(
      text
    );
  const hasProperty =
    /\b(home|house|business|commercial|residential)\b/.test(text) ||
    lead.message.length > 0;

  return hasIssue && hasProperty;
}

export function isLeadComplete(
  lead: LeadPayload,
  contextMessages?: LeadContextMessage[]
): boolean {
  if (!lead.requestType || !lead.name || !lead.phone) {
    return false;
  }

  if (isServiceRequestType(lead.requestType)) {
    if (!lead.name || !lead.phone || !lead.message.trim() || !lead.address.trim()) {
      return false;
    }
    return true;
  }

  if (!isValidEmail(lead.email) || !lead.address.trim()) {
    return false;
  }

  if (isSalesQuoteRequestType(lead.requestType)) {
    return contextMessages
      ? hasSalesQuoteQualification(contextMessages, lead)
      : lead.message.trim().length >= 10;
  }

  return lead.message.trim().length >= 8;
}

export function parseSubmitLeadToolArgs(
  args: string,
  contextMessages?: LeadContextMessage[]
): LeadPayload | null {
  try {
    const parsed = JSON.parse(args) as Record<string, unknown>;
    const lead = prepareLeadPayload(normalizeLeadPayload(parsed));
    return isLeadComplete(lead, contextMessages) ? lead : null;
  } catch {
    return null;
  }
}

export function leadFingerprint(lead: LeadPayload): string {
  return [
    lead.requestType,
    lead.name,
    lead.phone,
    lead.email,
    lead.address,
    lead.message,
  ]
    .join("|")
    .toLowerCase();
}
