import { Resend } from "resend";
import { NextResponse } from "next/server";

const FROM_EMAIL = "Platinum AI Assistant <onboarding@resend.dev>";

type LeadPayload = {
  requestType: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  urgency: string;
  message: string;
  conversationSummary: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidLeadPayload(body: unknown): body is LeadPayload {
  if (!body || typeof body !== "object") {
    return false;
  }

  const payload = body as Record<string, unknown>;

  return (
    isNonEmptyString(payload.requestType) &&
    isNonEmptyString(payload.name) &&
    isNonEmptyString(payload.phone) &&
    typeof payload.email === "string" &&
    typeof payload.address === "string" &&
    typeof payload.urgency === "string" &&
    typeof payload.message === "string" &&
    typeof payload.conversationSummary === "string"
  );
}

function formatLeadEmailBody(lead: LeadPayload): string {
  return `NEW LEAD

Request Type:
${lead.requestType.trim()}

Name:
${lead.name.trim()}

Phone:
${lead.phone.trim()}

Email:
${lead.email.trim() || "(not provided)"}

Address:
${lead.address.trim() || "(not provided)"}

Urgency:
${lead.urgency.trim() || "(not provided)"}

Message:
${lead.message.trim() || "(not provided)"}

Conversation Summary:
${lead.conversationSummary.trim() || "(not provided)"}`;
}

export async function POST(request: Request) {
  try {
    const resendApiKey = process.env.RESEND_API_KEY;
    const leadEmail = process.env.LEAD_EMAIL;

    if (!resendApiKey) {
      return NextResponse.json(
        { error: "RESEND_API_KEY is not configured." },
        { status: 500 }
      );
    }

    if (!leadEmail) {
      return NextResponse.json(
        { error: "LEAD_EMAIL is not configured." },
        { status: 500 }
      );
    }

    const body = await request.json();

    if (!isValidLeadPayload(body)) {
      return NextResponse.json(
        {
          error:
            "Invalid request body. requestType, name, and phone are required.",
        },
        { status: 400 }
      );
    }

    const resend = new Resend(resendApiKey);
    const requestType = body.requestType.trim();

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: leadEmail,
      subject: `New Platinum Chatbot Lead: ${requestType}`,
      text: formatLeadEmailBody(body),
    });

    if (error) {
      console.error("[/api/send-lead] Resend error:", error);
      return NextResponse.json(
        { error: error.message || "Failed to send lead email." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      id: data?.id,
    });
  } catch (error) {
    console.error("[/api/send-lead]", error);
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return NextResponse.json(
      { error: `Failed to send lead: ${message}` },
      { status: 500 }
    );
  }
}
