const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
let eventQueue = [];
const BATCH_LIMIT = 5; // Send data automatically once 5 events accumulate
const FLUSH_INTERVAL = 10000; // Alternatively, flush every 10 seconds

// Generate a random, temporary anonymous session ID so we don't track real IP/user data directly
const getAnonymousSessionId = () => {
  let sessionId = sessionStorage.getItem('analytics_session_id');
  if (!sessionId) {
    sessionId = Math.random().toString(36).substring(2, 15);
    sessionStorage.setItem('analytics_session_id', sessionId);
  }
  return sessionId;
};

// Send queued events to backend
export const flushQueue = async () => {
  if (eventQueue.length === 0) return;

  const payload = [...eventQueue];
  eventQueue = []; // Clear queue immediately to avoid duplicate sending on slow networks

  try {
    await fetch(`${API_URL}/analytics/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: payload }),
    });
  } catch (error) {
    console.error('Failed to flush analytics queue:', error);
    // Put back in queue if it fails
    eventQueue = [...payload, ...eventQueue];
  }
};

// Main function to capture an event
export const trackEvent = (eventType, elementClicked = null) => {
  const eventData = {
    eventType,
    elementClicked,
    pageUrl: window.location.pathname,
    timestamp: new Date().toISOString(),
    sessionId: getAnonymousSessionId(),
  };

  eventQueue.push(eventData);

  // Flush immediately if limit reached
  if (eventQueue.length >= BATCH_LIMIT) {
    flushQueue();
  }
};

// Periodically flush the queue automatically
clearInterval(window.__interval); window.__interval = setInterval(flushQueue, FLUSH_INTERVAL);

// Flush residual events when user closes/leaves the tab
window.addEventListener('beforeunload', () => {
  if (eventQueue.length > 0) {
    navigator.sendBeacon(`${API_URL}/analytics/event`, JSON.stringify({ events: eventQueue }));
  }
});
