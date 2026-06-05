import {
  isSalesQuoteRequestType,
  isServiceRequestType,
  type LeadContextMessage,
  type LeadPayload,
} from "@/lib/lead";
import type { CollectedLead } from "@/lib/leadCollection";

function getUserText(messages: LeadContextMessage[]): string {
  return messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function formatRequestTypeLabel(requestType: string): string {
  const map: Record<string, string> = {
    "new generator quote": "New Generator Quote",
    "generator service/repair": "Generator Service / Repair",
    "maintenance booking": "Maintenance Booking",
    "speak to someone": "Speak to Someone",
  };
  return map[requestType.toLowerCase()] ?? titleCase(requestType);
}

function inferPropertyType(text: string): string {
  if (/\b(business|commercial)\b/i.test(text)) return "Business";
  if (/\b(home|house|residential)\b/i.test(text)) return "Home";
  return "";
}

function inferBackupType(text: string): string {
  if (/\bwhole[\s-]?home\b/i.test(text)) return "Whole-home backup";
  if (/\bessential|circuit/i.test(text)) return "Essential circuits";
  return "";
}

function inferInstallationType(text: string): string {
  if (/\breplacement|replace|replacing\b/i.test(text)) return "Replacement";
  if (/\bnew install|new installation\b/i.test(text)) return "New installation";
  if (/\bnew\b/i.test(text)) return "New installation";
  return "";
}

function inferLocation(lead: LeadPayload, text: string): string {
  const cities =
    text.match(
      /\b(Ottawa|Toronto|Kingston|London|Hamilton|Belleville|Peterborough|Barrie|Oshawa|Mississauga|Brampton|Kitchener|Waterloo|Ontario)\b/i
    )?.[0] ?? "";
  if (cities) return titleCase(cities);
  const addressParts = lead.address.split(",").map((part) => part.trim());
  if (addressParts.length > 1) {
    return addressParts[addressParts.length - 2] || addressParts[0];
  }
  return lead.address;
}

export function buildLeadDisplayLines(
  lead: LeadPayload,
  messages: LeadContextMessage[],
  collected?: CollectedLead
): string[] {
  const text = getUserText(messages);
  const lines: string[] = [
    `Request type: ${formatRequestTypeLabel(lead.requestType)}`,
  ];

  if (isSalesQuoteRequestType(lead.requestType)) {
    const propertyType =
      collected?.propertyType || inferPropertyType(text) || "";
    const backupType = collected?.backupType || inferBackupType(text) || "";
    const installationType =
      collected?.installationType || inferInstallationType(text) || "";
    const location = collected?.location || inferLocation(lead, text) || "";

    if (propertyType) lines.push(`Property type: ${propertyType}`);
    if (backupType) lines.push(`Backup type: ${backupType}`);
    if (installationType) lines.push(`Installation type: ${installationType}`);
    if (location) lines.push(`Location: ${location}`);
  }

  if (isServiceRequestType(lead.requestType)) {
    const propertyType =
      collected?.propertyType || inferPropertyType(text) || "";
    const generatorModel = collected?.generatorModel || "Unknown";
    const issue = collected?.issue || lead.message || "";
    const issueStarted = collected?.issueStarted || "";
    const urgency = collected?.urgency || lead.urgency || "";

    if (propertyType) lines.push(`Property type: ${propertyType}`);
    lines.push(`Generator brand/model: ${generatorModel}`);
    if (issue) lines.push(`Issue: ${issue}`);
    if (issueStarted) lines.push(`Started: ${issueStarted}`);
    if (urgency) lines.push(`Urgency: ${titleCase(urgency)}`);
  }

  if (
    !isServiceRequestType(lead.requestType) &&
    lead.message &&
    !isSalesQuoteRequestType(lead.requestType)
  ) {
    lines.push(`Details: ${lead.message}`);
  }

  lines.push(`Name: ${lead.name}`);
  lines.push(`Phone: ${lead.phone}`);

  if (lead.email) {
    lines.push(`Email: ${lead.email}`);
  }

  if (lead.address) {
    lines.push(`Address: ${lead.address}`);
  }

  return lines;
}

function buildCustomerReviewLines(lead: LeadPayload): string[] {
  const lines: string[] = [
    `Name: ${lead.name}`,
    `Phone: ${lead.phone}`,
  ];

  if (lead.email) {
    lines.push(`Email: ${lead.email}`);
  }

  if (lead.address) {
    lines.push(`Address: ${lead.address}`);
  }

  return lines;
}

export function formatLeadReviewMessage(
  lead: LeadPayload,
  _messages?: LeadContextMessage[],
  _collected?: CollectedLead
): string {
  const lines = buildCustomerReviewLines(lead);
  const formatted = lines.map((line) => `- ${line}`).join("\n");
  return `Please review your information:\n\n${formatted}\n\nDoes everything look correct?`;
}

const CONFIRMATION_PATTERN =
  /^(yes|yeah|yep|yup|correct|looks good|look good|that'?s correct|that'?s right|that is correct|that is right|send it|confirmed|confirm|all good|go ahead|please send|submit)([,!\s]|$)/i;

const DENIAL_PATTERN =
  /^(no|nope|not quite|incorrect|wrong|not correct|needs changes|change|update)[!.?\s]*$/i;

const CORRECTION_PATTERN =
  /\b(my email|my phone|my name|my address|actually|instead|change|update|correction|wrong email|wrong phone|wrong address)\b|@[^\s@]+\.[^\s@]+|(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/i;

export function isLeadConfirmation(text: string): boolean {
  const trimmed = text.trim();
  return CONFIRMATION_PATTERN.test(trimmed);
}

export function isLeadDenial(text: string): boolean {
  const trimmed = text.trim();
  return DENIAL_PATTERN.test(trimmed);
}

export function looksLikeLeadCorrection(text: string): boolean {
  const trimmed = text.trim();
  if (isLeadConfirmation(trimmed) || isLeadDenial(trimmed)) {
    return false;
  }
  return CORRECTION_PATTERN.test(trimmed);
}

export function unclearReviewReply(text: string): boolean {
  const trimmed = text.trim();
  return (
    !isLeadConfirmation(trimmed) &&
    !isLeadDenial(trimmed) &&
    !looksLikeLeadCorrection(trimmed)
  );
}

export const REVIEW_PROMPT =
  "Please reply yes to confirm, or tell me what to change.";
