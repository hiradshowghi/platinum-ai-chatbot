"use client";

import { useEffect, useRef, useState } from "react";
import {
  applyBotTurnToCollectedLead,
  applyReviewCorrection,
  applyUserTurnToCollectedLead,
  createEmptyCollectedLead,
  inferExpectedFieldFromBotMessage,
  isCasualMessage,
  resolveLeadFromCollection,
  type CollectedLead,
  type ExpectedField,
} from "@/lib/leadCollection";
import {
  isLeadComplete,
  leadFingerprint,
  type LeadPayload,
} from "@/lib/lead";
import {
  formatLeadReviewMessage,
  isLeadConfirmation,
  isLeadDenial,
  looksLikeLeadCorrection,
  REVIEW_PROMPT,
  unclearReviewReply,
} from "@/lib/leadReview";

type Message = {
  id: string;
  role: "user" | "bot";
  content: string;
};

type ApiMessage = {
  role: "user" | "assistant";
  content: string;
};

type LeadStatus = "collecting" | "reviewing" | "submitted";

const INITIAL_BOT_MESSAGE =
  "Hello! Welcome to Platinum Electrical Contractors. How can I help you today?";

const QUICK_ACTIONS = [
  { label: "Quote", message: "New Generator Quote" },
  { label: "Service", message: "Generator Service / Repair" },
  { label: "Maintenance", message: "Maintenance Booking" },
  { label: "Contact", message: "Speak to Someone" },
] as const;

const LEAD_SUCCESS_MESSAGE =
  "Your information has been sent to our team. Someone will follow up with you shortly.";

const LEAD_FAILURE_MESSAGE =
  "I have your details, but there was an issue sending the request. Please try again or call the team directly.";

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function toApiMessages(messages: Message[]): ApiMessage[] {
  return messages.map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
  }));
}

export default function Chatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: createId(),
      role: "bot",
      content: INITIAL_BOT_MESSAGE,
    },
  ]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const submittedLeadFingerprintsRef = useRef<Set<string>>(new Set());
  const leadSubmitInFlightRef = useRef<string | null>(null);
  const pendingLeadRef = useRef<LeadPayload | null>(null);
  const collectedLeadRef = useRef<CollectedLead>(createEmptyCollectedLead());
  const currentExpectedFieldRef = useRef<ExpectedField>(null);
  const leadStatusRef = useRef<LeadStatus>("collecting");
  const pendingReviewFingerprintRef = useRef<string | null>(null);
  const [leadStatus, setLeadStatus] = useState<LeadStatus>("collecting");

  function setLeadStatusState(status: LeadStatus) {
    leadStatusRef.current = status;
    setLeadStatus(status);
  }

  function evaluateLeadStateAndMaybeShowReview(
    conversation: Message[],
    apiLead?: LeadPayload | null
  ): boolean {
    if (leadStatusRef.current === "submitted") {
      return false;
    }

    if (leadStatusRef.current === "reviewing") {
      return false;
    }

    const payload = resolveLeadFromCollection(
      collectedLeadRef.current,
      conversation,
      apiLead ?? null
    );

    if (!payload) {
      return false;
    }

    const fingerprint = leadFingerprint(payload);
    if (submittedLeadFingerprintsRef.current.has(fingerprint)) {
      return false;
    }

    if (pendingReviewFingerprintRef.current === fingerprint) {
      return false;
    }

    const lastMessage = conversation[conversation.length - 1];
    if (
      lastMessage?.role === "bot" &&
      lastMessage.content.includes("Does everything look correct?")
    ) {
      return false;
    }

    pendingReviewFingerprintRef.current = fingerprint;

    pendingLeadRef.current = payload;
    setLeadStatusState("reviewing");

    setMessages((prev) => [
      ...prev,
      {
        id: createId(),
        role: "bot",
        content: formatLeadReviewMessage(
          payload,
          conversation,
          collectedLeadRef.current
        ),
      },
    ]);

    return true;
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  async function submitLead(lead: LeadPayload, contextMessages: Message[]) {
    if (!isLeadComplete(lead, contextMessages)) {
      return;
    }

    const fingerprint = leadFingerprint(lead);

    if (
      submittedLeadFingerprintsRef.current.has(fingerprint) ||
      leadSubmitInFlightRef.current === fingerprint
    ) {
      return;
    }

    leadSubmitInFlightRef.current = fingerprint;

    try {
      const response = await fetch("/api/send-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lead),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "Failed to send your information."
        );
      }

      submittedLeadFingerprintsRef.current.add(fingerprint);
      setLeadStatusState("submitted");
      pendingLeadRef.current = null;
      pendingReviewFingerprintRef.current = null;

      setMessages((prev) => [
        ...prev,
        { id: createId(), role: "bot", content: LEAD_SUCCESS_MESSAGE },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: createId(), role: "bot", content: LEAD_FAILURE_MESSAGE },
      ]);
    } finally {
      if (leadSubmitInFlightRef.current === fingerprint) {
        leadSubmitInFlightRef.current = null;
      }
    }
  }

  function isLeadPayload(value: unknown): value is LeadPayload {
    if (!value || typeof value !== "object") return false;
    const lead = value as Record<string, unknown>;
    return (
      typeof lead.requestType === "string" &&
      typeof lead.name === "string" &&
      typeof lead.phone === "string" &&
      typeof lead.email === "string" &&
      typeof lead.address === "string" &&
      typeof lead.urgency === "string" &&
      typeof lead.message === "string" &&
      typeof lead.conversationSummary === "string"
    );
  }

  async function sendUserMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    const userMessage: Message = {
      id: createId(),
      role: "user",
      content: trimmed,
    };

    if (leadStatusRef.current === "reviewing" && pendingLeadRef.current) {
      const pending = pendingLeadRef.current;
      const conversationAfterUser = [...messages, userMessage];

      if (isLeadConfirmation(trimmed)) {
        setMessages((prev) => [...prev, userMessage]);
        setIsLoading(true);
        try {
          await submitLead(pending, conversationAfterUser);
        } finally {
          setIsLoading(false);
        }
        return;
      }

      if (
        isCasualMessage(trimmed) &&
        !looksLikeLeadCorrection(trimmed) &&
        !isLeadDenial(trimmed)
      ) {
        setMessages((prev) => [
          ...prev,
          userMessage,
          {
            id: createId(),
            role: "bot",
            content: `${REVIEW_PROMPT}\n\n${formatLeadReviewMessage(pending, conversationAfterUser, collectedLeadRef.current)}`,
          },
        ]);
        return;
      }

      if (isLeadDenial(trimmed) || looksLikeLeadCorrection(trimmed)) {
        collectedLeadRef.current = applyReviewCorrection(
          collectedLeadRef.current,
          trimmed
        );
        const updated =
          resolveLeadFromCollection(
            collectedLeadRef.current,
            conversationAfterUser,
            pending
          ) ?? pending;
        pendingLeadRef.current = updated;
        pendingReviewFingerprintRef.current = leadFingerprint(updated);

        setMessages((prev) => [
          ...prev,
          userMessage,
          {
            id: createId(),
            role: "bot",
            content: formatLeadReviewMessage(
              updated,
              conversationAfterUser,
              collectedLeadRef.current
            ),
          },
        ]);
        return;
      }

      if (unclearReviewReply(trimmed)) {
        setMessages((prev) => [
          ...prev,
          userMessage,
          {
            id: createId(),
            role: "bot",
            content: `${REVIEW_PROMPT}\n\n${formatLeadReviewMessage(pending, conversationAfterUser, collectedLeadRef.current)}`,
          },
        ]);
        return;
      }
    }

    const lastBotMessage = [...messages].reverse().find((m) => m.role === "bot");
    const expectedField =
      currentExpectedFieldRef.current ??
      (lastBotMessage
        ? inferExpectedFieldFromBotMessage(lastBotMessage.content)
        : null);

    collectedLeadRef.current = applyUserTurnToCollectedLead(
      collectedLeadRef.current,
      trimmed,
      expectedField
    );
    currentExpectedFieldRef.current = null;

    const conversationAfterUser = [...messages, userMessage];

    setMessages((prev) => [...prev, userMessage]);

    if (evaluateLeadStateAndMaybeShowReview(conversationAfterUser)) {
      return;
    }

    const historyForApi = toApiMessages(conversationAfterUser);
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: historyForApi }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "Something went wrong. Please try again."
        );
      }

      if (typeof data.message !== "string" || !data.message.trim()) {
        throw new Error("Received an empty response from the assistant.");
      }

      const botMessage: Message = {
        id: createId(),
        role: "bot",
        content: data.message.trim(),
      };

      const conversationAfterReply: Message[] = [
        ...conversationAfterUser,
        botMessage,
      ];

      collectedLeadRef.current = applyBotTurnToCollectedLead(
        collectedLeadRef.current,
        botMessage.content,
        isLeadPayload(data.lead) ? data.lead : null
      );
      currentExpectedFieldRef.current = inferExpectedFieldFromBotMessage(
        botMessage.content
      );

      if (evaluateLeadStateAndMaybeShowReview(conversationAfterReply, isLeadPayload(data.lead) ? data.lead : null)) {
        return;
      }

      setMessages((prev) => [...prev, botMessage]);
    } catch (error) {
      const errorText =
        error instanceof Error
          ? error.message
          : "Unable to reach the assistant. Please try again.";

      setMessages((prev) => [
        ...prev,
        {
          id: createId(),
          role: "bot",
          content: `Sorry, I couldn't process your request right now. ${errorText}`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  function handleQuickAction(message: string) {
    void sendUserMessage(message);
  }

  function handleSend(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;

    setInput("");
    void sendUserMessage(trimmed);
  }

  const showQuickActions = !messages.some((message) => message.role === "user");

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 sm:bg-transparent sm:pointer-events-none"
          aria-hidden="true"
          onClick={() => setIsOpen(false)}
        />
      )}

      <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
        {isOpen && (
          <div
            role="dialog"
            aria-labelledby="chatbot-title"
            aria-modal="true"
            className="pointer-events-auto flex h-[min(72vh,540px)] w-[min(calc(100vw-2rem),380px)] flex-col overflow-hidden rounded-2xl border border-neutral-100 bg-white shadow-[0_8px_40px_rgba(0,0,0,0.12)] ring-1 ring-black/[0.04] sm:h-[min(78vh,580px)] sm:w-[400px]"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex shrink-0 items-center justify-between bg-black px-4 py-3.5">
              <div className="min-w-0 flex-1 pr-3">
                <h2
                  id="chatbot-title"
                  className="truncate text-sm font-semibold leading-tight text-white sm:text-[15px]"
                >
                  Platinum Electrical Contractors
                </h2>
                <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-neutral-400">
                  <span className="truncate font-medium text-neutral-300">
                    Generac Sales &amp; Service
                  </span>
                  <span className="shrink-0 text-neutral-600" aria-hidden="true">
                    ·
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-green-500"
                      aria-hidden="true"
                    />
                    <span className="text-[11px] font-medium text-neutral-400">
                      Online
                    </span>
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="shrink-0 rounded-full p-1.5 text-neutral-500 transition-all duration-200 hover:bg-white/10 hover:text-white"
                aria-label="Close chat"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </header>

            <div className="flex min-h-0 flex-1 flex-col bg-[#fafafa]">
              <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3.5 sm:px-4 sm:py-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm ${
                        message.role === "user"
                          ? "rounded-br-md bg-neutral-800 text-white shadow-neutral-900/10"
                          : "rounded-bl-md border border-neutral-200/60 bg-neutral-200 text-neutral-900 shadow-neutral-900/[0.04]"
                      }`}
                    >
                      {message.content}
                    </div>
                  </div>
                ))}

                {isLoading && (
                  <div className="flex justify-start" aria-live="polite" aria-busy="true">
                    <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-neutral-200/60 bg-neutral-200 px-4 py-3 shadow-sm">
                      <span className="sr-only">Assistant is typing</span>
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:0ms]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:150ms]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:300ms]" />
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {showQuickActions && (
                <div className="shrink-0 border-t border-neutral-100 bg-white px-3 py-2.5 sm:px-4">
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_ACTIONS.map((action) => (
                      <button
                        key={action.message}
                        type="button"
                        disabled={isLoading}
                        onClick={() => handleQuickAction(action.message)}
                        className="rounded-full border border-neutral-100 bg-[#fafafa] px-3.5 py-1.5 text-xs font-medium tracking-wide text-neutral-600 shadow-sm transition-all duration-200 hover:border-red-200 hover:bg-white hover:text-red-700 hover:shadow disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <form
                onSubmit={handleSend}
                className="shrink-0 border-t border-neutral-100 bg-white p-3 sm:p-3.5"
              >
                <div className="flex items-center gap-2">
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Type your message..."
                    disabled={isLoading}
                    className="min-w-0 flex-1 rounded-xl border border-neutral-100 bg-[#fafafa] px-3.5 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 transition-all duration-200 focus:border-neutral-200 focus:bg-white focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-60"
                    aria-label="Message"
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || isLoading}
                    className="shrink-0 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold tracking-wide text-white shadow-sm shadow-red-900/20 transition-all duration-200 hover:bg-red-700 hover:shadow-md hover:shadow-red-900/25 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                  >
                    Send
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full bg-neutral-900 text-white shadow-[0_4px_24px_rgba(0,0,0,0.18)] ring-1 ring-white/10 transition-all duration-300 hover:scale-105 hover:shadow-[0_6px_28px_rgba(0,0,0,0.22)] hover:ring-red-500/40 focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:ring-offset-2 active:scale-100 sm:h-16 sm:w-16"
          aria-label={isOpen ? "Close chat" : "Open chat"}
          aria-expanded={isOpen}
        >
          {isOpen ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-6 w-6"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-6 w-6 sm:h-7 sm:w-7"
              aria-hidden="true"
            >
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" />
            </svg>
          )}
        </button>
      </div>
    </>
  );
}
