"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ThumbsUp, ThumbsDown, Loader2, AlertTriangle } from "lucide-react";
import { useFeedbackContextOptional } from "@/contexts/FeedbackContext";
import type { MessageObject, ToolUseMessages } from "@/types/agentic-session";

export type FeedbackType = "positive" | "negative";

type FeedbackModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feedbackType: FeedbackType;
  messageContent?: string;
  messageTimestamp?: string;
  onSubmitSuccess?: () => void;
};

// Helper to extract text content from messages
function extractMessageText(
  messages: Array<MessageObject | ToolUseMessages>
): Array<{ role: string; content: string; timestamp?: string }> {
  return messages
    .filter((m): m is MessageObject => "type" in m && m.type !== undefined)
    .filter((m) => m.type === "user_message" || m.type === "agent_message")
    .map((m) => {
      let content = "";
      if (typeof m.content === "string") {
        content = m.content;
      } else if ("text" in m.content) {
        content = m.content.text;
      } else if ("thinking" in m.content) {
        content = m.content.thinking;
      }
      return {
        role: m.type === "user_message" ? "user" : "assistant",
        content,
        timestamp: m.timestamp,
      };
    });
}

export function FeedbackModal({
  open,
  onOpenChange,
  feedbackType,
  messageContent,
  onSubmitSuccess,
}: FeedbackModalProps) {
  const [comment, setComment] = useState("");
  const [includeTranscript, setIncludeTranscript] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const feedbackContext = useFeedbackContextOptional();

  const handleSubmit = async () => {
    if (!feedbackContext) {
      setError("Session context not available");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Build context string from what the user was working on
      const contextParts: string[] = [];
      
      if (feedbackContext.initialPrompt) {
        contextParts.push(`Initial prompt: ${feedbackContext.initialPrompt.substring(0, 200)}`);
      }
      
      if (feedbackContext.activeWorkflow) {
        contextParts.push(`Workflow: ${feedbackContext.activeWorkflow}`);
      }
      
      if (messageContent) {
        contextParts.push(`Response being rated: ${messageContent.substring(0, 500)}`);
      }

      const transcript = includeTranscript
        ? extractMessageText(feedbackContext.messages)
        : undefined;

      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          value: feedbackType === "positive" ? 1 : 0,
          comment: comment || undefined,
          username: feedbackContext.username,
          projectName: feedbackContext.projectName,
          sessionName: feedbackContext.sessionName,
          context: contextParts.join("; "),
          includeTranscript,
          transcript,
          traceId: feedbackContext.traceId,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to submit feedback");
      }

      // Success - close modal and reset
      setComment("");
      setIncludeTranscript(false);
      onOpenChange(false);
      onSubmitSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit feedback");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setComment("");
    setIncludeTranscript(false);
    setError(null);
    onOpenChange(false);
  };

  const isPositive = feedbackType === "positive";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isPositive ? (
              <>
                <ThumbsUp className="h-5 w-5 text-green-500" />
                <span>Thanks for the positive feedback!</span>
              </>
            ) : (
              <>
                <ThumbsDown className="h-5 w-5 text-red-500" />
                <span>We&apos;re sorry this wasn&apos;t helpful</span>
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {isPositive
              ? "Help us understand what worked well."
              : "Help us improve by sharing what went wrong."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Comment textarea */}
          <div className="space-y-2">
            <Label htmlFor="feedback-comment">
              Additional comments (optional)
            </Label>
            <Textarea
              id="feedback-comment"
              placeholder={
                isPositive
                  ? "What did you find helpful about this response?"
                  : "What could be improved? Was the response inaccurate, unclear, or incomplete?"
              }
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>

          {/* Include transcript checkbox */}
          <div className="flex items-start space-x-3">
            <Checkbox
              id="include-transcript"
              checked={includeTranscript}
              onCheckedChange={(checked) => setIncludeTranscript(checked === true)}
            />
            <div className="space-y-1">
              <Label
                htmlFor="include-transcript"
                className="text-sm font-medium cursor-pointer"
              >
                Include chat transcript with feedback
              </Label>
              <p className="text-xs text-muted-foreground">
                This helps us understand the full context of your experience.
              </p>
            </div>
          </div>

          {/* Privacy disclaimer */}
          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-500" />
              <div>
                <p className="font-medium text-foreground">Privacy Notice</p>
                <ul className="list-disc list-inside mt-1 space-y-1">
                  <li>
                    Your feedback will be stored in our observability system to improve the platform.
                  </li>
                  <li>
                    Your username and session details will be associated with this feedback.
                  </li>
                  {includeTranscript && (
                    <li className="text-amber-600 dark:text-amber-400">
                      The chat transcript you&apos;ve opted to include may contain sensitive information from your session.
                    </li>
                  )}
                  <li>
                    Feedback data is used solely for improving the Ambient Code Platform experience.
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Submit Feedback
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
