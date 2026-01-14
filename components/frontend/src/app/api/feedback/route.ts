import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/feedback
 * 
 * Sends user feedback to Langfuse as a score.
 * This route acts as a proxy to protect the Langfuse secret key.
 * 
 * Request body:
 * - traceId: string (optional - if we have a trace ID from the session)
 * - value: number (1 for positive, 0 for negative)
 * - comment?: string (optional user comment)
 * - username: string
 * - projectName: string
 * - sessionName: string
 * - context?: string (what the user was working on)
 * - includeTranscript?: boolean
 * - transcript?: Array<{ role: string; content: string; timestamp?: string }>
 */

type FeedbackRequest = {
  traceId?: string;
  value: number;
  comment?: string;
  username: string;
  projectName: string;
  sessionName: string;
  context?: string;
  includeTranscript?: boolean;
  transcript?: Array<{ role: string; content: string; timestamp?: string }>;
};

export async function POST(request: NextRequest) {
  try {
    const body: FeedbackRequest = await request.json();
    
    const {
      traceId,
      value,
      comment,
      username,
      projectName,
      sessionName,
      context,
      includeTranscript,
      transcript,
    } = body;

    // Validate required fields
    if (typeof value !== 'number' || !username || !projectName || !sessionName) {
      return NextResponse.json(
        { error: 'Missing required fields: value, username, projectName, sessionName' },
        { status: 400 }
      );
    }

    // Get Langfuse configuration from environment
    const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
    const secretKey = process.env.LANGFUSE_SECRET_KEY;
    const host = process.env.LANGFUSE_HOST || process.env.NEXT_PUBLIC_LANGFUSE_HOST;

    if (!publicKey || !secretKey || !host) {
      console.warn('Langfuse not configured - feedback will not be recorded');
      return NextResponse.json({ 
        success: false, 
        message: 'Langfuse not configured' 
      });
    }

    // Build the feedback comment with context
    const feedbackParts: string[] = [];
    
    if (comment) {
      feedbackParts.push(`User Comment: ${comment}`);
    }
    
    feedbackParts.push(`Project: ${projectName}`);
    feedbackParts.push(`Session: ${sessionName}`);
    feedbackParts.push(`User: ${username}`);
    
    if (context) {
      feedbackParts.push(`Context: ${context}`);
    }
    
    if (includeTranscript && transcript && transcript.length > 0) {
      // Limit transcript to last 10 messages to avoid huge payloads
      const recentMessages = transcript.slice(-10);
      const transcriptSummary = recentMessages
        .map(m => `[${m.role}]: ${m.content.substring(0, 200)}${m.content.length > 200 ? '...' : ''}`)
        .join('\n');
      feedbackParts.push(`\nRecent Transcript:\n${transcriptSummary}`);
    }

    const fullComment = feedbackParts.join('\n');

    // Prepare the score payload for Langfuse
    // If we don't have a traceId, we create a standalone score event
    const scorePayload = {
      name: 'user-feedback',
      value: value,
      comment: fullComment,
      // Include metadata for filtering in Langfuse
      dataType: 'NUMERIC' as const,
    };

    // If we have a traceId, attach the score to that trace
    // Otherwise, we create the score and associate with session metadata
    const endpoint = traceId 
      ? `${host}/api/public/scores`
      : `${host}/api/public/scores`;

    const payload = traceId 
      ? { ...scorePayload, traceId }
      : { 
          ...scorePayload, 
          // When no traceId, include identifying metadata
          traceId: `feedback-${sessionName}-${Date.now()}`,
        };

    // Send to Langfuse API
    const authHeader = Buffer.from(`${publicKey}:${secretKey}`).toString('base64');
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${authHeader}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Langfuse API error:', response.status, errorText);
      return NextResponse.json(
        { error: 'Failed to submit feedback to Langfuse' },
        { status: 500 }
      );
    }

    const result = await response.json();
    
    return NextResponse.json({ 
      success: true, 
      scoreId: result.id,
      message: 'Feedback submitted successfully' 
    });

  } catch (error) {
    console.error('Error submitting feedback:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
