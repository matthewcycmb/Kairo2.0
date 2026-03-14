import { useState, useEffect, useRef, useCallback } from "react";
import type { AppView, AdvisorMessage, StudentGoals } from "./types/profile";
import type { ParsedActivity } from "./types/activity";
import type { FollowUpRound, StudentProfile } from "./types/profile";
import BrainDumpPage from "./pages/BrainDumpPage";
import ChatPage from "./pages/ChatPage";
import ProfilePage from "./pages/ProfilePage";
import GoalSetupPage from "./pages/GoalSetupPage";
import { createProfile, updateProfile, loadProfile, saveAdvisorMessages, loadAdvisorMessages, listConversations, deleteConversation, saveIdentifier } from "./lib/profileApi";
import type { ConversationSummary } from "./types/profile";
import { callApi } from "./lib/apiClient";
import { Analytics } from "@vercel/analytics/react";

const initialProfileId = new URLSearchParams(window.location.search).get("p");

function getCachedProfile(id: string | null): StudentProfile | null {
  if (!id) return null;
  try {
    const raw = localStorage.getItem(`kairo_profile_${id}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const cachedProfile = getCachedProfile(initialProfileId);

function App() {
  const [currentView, setCurrentView] = useState<AppView>(
    cachedProfile ? "profile" : initialProfileId ? "loading" : "input"
  );
  const [rawText, setRawText] = useState("");
  const [profile, setProfile] = useState<StudentProfile>(
    cachedProfile || { activities: [], lastUpdated: new Date() }
  );
  const [followUpRounds, setFollowUpRounds] = useState<FollowUpRound[]>([]);
  const [currentRound, setCurrentRound] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(initialProfileId);
  // Advisor state
  const [advisorMessages, setAdvisorMessages] = useState<AdvisorMessage[]>(cachedProfile?.advisorMessages || []);
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [refreshingAnalysis, setRefreshingAnalysis] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [latestConvId, setLatestConvId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const latestConvMessagesRef = useRef<AdvisorMessage[]>([]);
  const advisorInitRef = useRef(false);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedSave = useCallback(
    (id: string, data: StudentProfile) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        try { localStorage.setItem(`kairo_profile_${id}`, JSON.stringify(data)); } catch {}
        updateProfile(id, data).catch((err) =>
          console.error("Auto-save failed:", err)
        );
      }, 500);
    },
    []
  );

  // Load profile from URL on mount
  useEffect(() => {
    if (!initialProfileId) return;

    loadProfile(initialProfileId)
      .then((loaded) => {
        if (loaded) {
          setProfile(loaded);
          try { localStorage.setItem(`kairo_profile_${initialProfileId}`, JSON.stringify(loaded)); } catch {}
          if (loaded.advisorMessages?.length) {
            setAdvisorMessages(loaded.advisorMessages);
          }
          setCurrentView("profile");
        } else {
          setProfileId(null);
          setCurrentView("input");
        }
      })
      .catch(() => {
        setProfileId(null);
        setCurrentView("input");
      });
  }, []);

  const handleBrainDumpSubmit = (text: string) => {
    setRawText(text);
    setCurrentView("chat");
  };

  const handleActivitiesParsed = (
    activities: ParsedActivity[],
    rounds: FollowUpRound[]
  ) => {
    setProfile({ activities, lastUpdated: new Date() });
    setFollowUpRounds(rounds);
    setCurrentRound(1);
  };

  const handleFollowUpComplete = (
    updatedActivities: ParsedActivity[],
    newRounds: FollowUpRound[]
  ) => {
    setProfile({ activities: updatedActivities, lastUpdated: new Date() });
    if (newRounds.length > 0 && currentRound < 2) {
      setFollowUpRounds((prev) => [...prev, ...newRounds]);
      setCurrentRound((prev) => prev + 1);
    }
  };

  const handleGenerateProfile = async () => {
    setCurrentView("goals");
    try {
      const id = await createProfile(profile);
      setProfileId(id);
      try { localStorage.setItem(`kairo_profile_${id}`, JSON.stringify(profile)); } catch {}
      history.replaceState(null, "", "?p=" + id);
    } catch (err) {
      console.error("Failed to save profile:", err);
    }
  };

  const handleGoalsComplete = (goals: StudentGoals) => {
    setProfile((prev) => {
      const next = { ...prev, goals, lastUpdated: new Date() };
      if (profileId) debouncedSave(profileId, next);
      return next;
    });
    if (profileId && goals.email) {
      saveIdentifier(profileId, goals.email).catch(console.error);
    }
    setCurrentView("profile");
  };

  const handleEditActivity = (
    id: string,
    updates: Partial<ParsedActivity>
  ) => {
    setProfile((prev) => {
      const next = {
        ...prev,
        activities: prev.activities.map((a) =>
          a.id === id ? { ...a, ...updates } : a
        ),
        lastUpdated: new Date(),
      };
      if (profileId) debouncedSave(profileId, next);
      return next;
    });
  };

  const handleAddActivities = (newActivities: ParsedActivity[]) => {
    setProfile((prev) => {
      const next = {
        ...prev,
        activities: [...prev.activities, ...newActivities],
        lastUpdated: new Date(),
      };
      if (profileId) debouncedSave(profileId, next);
      return next;
    });
  };

  const handleAdvisorMessage = async (userText: string) => {
    const userMsg: AdvisorMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: userText,
      timestamp: new Date().toISOString(),
      conversationId: conversationId ?? undefined,
    };

    const updatedMessages = [...advisorMessages, userMsg];
    setAdvisorMessages(updatedMessages);
    setAdvisorLoading(true);

    try {
      const response = await callApi({
        type: "advisor",
        profile,
        messages: updatedMessages,
        isFirstMessage: false,
      });

      // Ensure message is always a plain string
      const messageText = typeof response.message === "string"
        ? response.message
        : (response.message as Record<string, unknown>)?.message as string ?? JSON.stringify(response.message);

      const assistantMsg: AdvisorMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: messageText,
        timestamp: new Date().toISOString(),
        suggestions: response.suggestions,
        conversationId: conversationId ?? undefined,
      };

      const allMessages = [...updatedMessages, assistantMsg];
      setAdvisorMessages(allMessages);
      if (conversationId === latestConvId) {
        latestConvMessagesRef.current = allMessages;
      }

      // Persist to Supabase
      if (profileId) {
        await saveAdvisorMessages(profileId, [userMsg, assistantMsg], conversationId ?? undefined).catch(console.error);
      }

      // Also persist to profile blob immediately
      setProfile((prev) => {
        const next = { ...prev, advisorMessages: allMessages, lastUpdated: new Date() };
        if (profileId) {
          try { localStorage.setItem(`kairo_profile_${profileId}`, JSON.stringify(next)); } catch {}
          updateProfile(profileId, next).catch(console.error);
        }
        return next;
      });
    } catch (err) {
      console.error("Advisor error:", err);
      const errorMsg: AdvisorMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Sorry, something went wrong: ${err instanceof Error ? err.message : "Try again in a moment."}`,
        timestamp: new Date().toISOString(),
      };
      setAdvisorMessages((prev) => [...prev, errorMsg]);
    } finally {
      setAdvisorLoading(false);
    }
  };

  const handleAdvisorTabOpened = async () => {
    if (advisorInitRef.current) return;
    advisorInitRef.current = true;

    try {
      // Step 1: Load from Supabase (silently — no loading spinner)
      let loadedMessages: AdvisorMessage[] = [];

      if (profileId) {
        try {
          loadedMessages = await loadAdvisorMessages(profileId);
        } catch (err) {
          console.error("Failed to load from Supabase:", err);
        }
      }

      // Fallback: use profile blob messages/items if Supabase is empty
      if (loadedMessages.length === 0 && advisorMessages.length > 0) {
        loadedMessages = advisorMessages;
        if (profileId) {
          saveAdvisorMessages(profileId, advisorMessages).catch(console.error);
        }
      }
      // Step 2: If messages exist → restore history (no spinner needed)
      if (loadedMessages.length > 0) {
        // Extract conversationId from loaded messages
        const existingConvId = loadedMessages.find((m) => m.conversationId)?.conversationId ?? null;
        if (existingConvId) {
          setConversationId(existingConvId);
          setLatestConvId(existingConvId);
        } else {
          // Legacy messages without conversationId — assign one and re-save
          const newConvId = crypto.randomUUID();
          setConversationId(newConvId);
          setLatestConvId(newConvId);
          const tagged = loadedMessages.map((m) => ({ ...m, conversationId: newConvId }));
          loadedMessages = tagged;
          if (profileId) {
            saveAdvisorMessages(profileId, tagged, newConvId).catch(console.error);
          }
        }
        setAdvisorMessages(loadedMessages);
        latestConvMessagesRef.current = loadedMessages;
        return;
      }

      // Step 3: No messages at all → show empty chat (AO summary card shows if available)
      const newConvId = crypto.randomUUID();
      setConversationId(newConvId);
      setLatestConvId(newConvId);
      setAdvisorMessages([]);
      latestConvMessagesRef.current = [];
    } catch (err) {
      console.error("Advisor init error:", err);
      advisorInitRef.current = false; // Allow retry
      const errorMsg: AdvisorMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Something went wrong: ${err instanceof Error ? err.message : "Check your connection and try again."}`,
        timestamp: new Date().toISOString(),
      };
      setAdvisorMessages([errorMsg]);
    } finally {
      setAdvisorLoading(false);
    }
  };

  const handleNewConversation = async () => {
    setRefreshingAnalysis(true);
    const newConvId = crypto.randomUUID();
    try {
      setConversationId(newConvId);
      setLatestConvId(newConvId);

      const response = await callApi({
        type: "advisor",
        profile,
        messages: [],
        isFirstMessage: true,
      });

      const firstMsg: AdvisorMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: response.message,
        timestamp: new Date().toISOString(),
        suggestions: response.suggestions,
        conversationId: newConvId,
      };

      // Replace visible chat with fresh conversation (old messages preserved in DB)
      setAdvisorMessages([firstMsg]);
      latestConvMessagesRef.current = [firstMsg];

      if (profileId) {
        await saveAdvisorMessages(profileId, [firstMsg], newConvId).catch(console.error);
      }

      setProfile((prev) => {
        const next = { ...prev, advisorMessages: [firstMsg], lastUpdated: new Date() };
        if (profileId) {
          try { localStorage.setItem(`kairo_profile_${profileId}`, JSON.stringify(next)); } catch {}
          updateProfile(profileId, next).catch(console.error);
        }
        return next;
      });
    } catch (err) {
      console.error("New conversation error:", err);
      const errorMsg: AdvisorMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Something went wrong: ${err instanceof Error ? err.message : "Check your connection and try again."}`,
        timestamp: new Date().toISOString(),
        conversationId: newConvId,
      };
      setAdvisorMessages([errorMsg]);
    } finally {
      setRefreshingAnalysis(false);
    }
  };

  const handleDiscussStrategy = async (strategyContext: string): Promise<void> => {
    advisorInitRef.current = true; // prevent race with handleAdvisorTabOpened
    setRefreshingAnalysis(true);
    const newConvId = crypto.randomUUID();
    try {
      setConversationId(newConvId);
      setLatestConvId(newConvId);

      const response = await callApi({
        type: "advisor",
        profile,
        messages: [],
        isFirstMessage: true,
        strategyContext,
      });

      const messageText = typeof response.message === "string"
        ? response.message
        : (response.message as Record<string, unknown>)?.message as string ?? JSON.stringify(response.message);

      const firstMsg: AdvisorMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: messageText,
        timestamp: new Date().toISOString(),
        suggestions: response.suggestions,
        conversationId: newConvId,
      };

      setAdvisorMessages([firstMsg]);
      latestConvMessagesRef.current = [firstMsg];
      advisorInitRef.current = true;

      if (profileId) {
        await saveAdvisorMessages(profileId, [firstMsg], newConvId).catch(console.error);
      }

      setProfile((prev) => {
        const next = { ...prev, advisorMessages: [firstMsg], lastUpdated: new Date() };
        if (profileId) {
          try { localStorage.setItem(`kairo_profile_${profileId}`, JSON.stringify(next)); } catch {}
          updateProfile(profileId, next).catch(console.error);
        }
        return next;
      });
    } catch (err) {
      console.error("Discuss strategy error:", err);
      const errorMsg: AdvisorMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Something went wrong: ${err instanceof Error ? err.message : "Check your connection and try again."}`,
        timestamp: new Date().toISOString(),
        conversationId: newConvId,
      };
      setAdvisorMessages([errorMsg]);
    } finally {
      setRefreshingAnalysis(false);
    }
  };

  const handleLoadConversation = async (convId: string) => {
    if (!profileId) return;
    // If we're currently on the latest conversation, stash its messages
    if (conversationId === latestConvId) {
      latestConvMessagesRef.current = advisorMessages;
    }
    try {
      const msgs = await loadAdvisorMessages(profileId, convId);
      setAdvisorMessages(msgs);
      setConversationId(convId);
    } catch (err) {
      console.error("Failed to load conversation:", err);
    }
  };

  const handleBackToCurrent = useCallback(() => {
    setConversationId(latestConvId);
    setAdvisorMessages(latestConvMessagesRef.current);
  }, [latestConvId]);

  const handleDeleteConversation = async (convId: string) => {
    if (!profileId) return;
    try {
      await deleteConversation(profileId, convId);
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      // If we just deleted the conversation we're viewing, go back to current
      if (convId === conversationId && convId !== latestConvId) {
        setConversationId(latestConvId);
        setAdvisorMessages(latestConvMessagesRef.current);
      }
    } catch (err) {
      console.error("Failed to delete conversation:", err);
    }
  };

  const handleListConversations = async () => {
    if (!profileId) return;
    try {
      const convs = await listConversations(profileId);
      // Exclude the current conversation from the list
      setConversations(convs.filter((c) => c.id !== conversationId));
    } catch (err) {
      console.error("Failed to list conversations:", err);
    }
  };

  const handleStartOver = () => {
    if (profileId) try { localStorage.removeItem(`kairo_profile_${profileId}`); } catch {}
    setCurrentView("input");
    setRawText("");
    setProfile({ activities: [], lastUpdated: new Date() });
    setFollowUpRounds([]);
    setCurrentRound(0);
    setError(null);
    setProfileId(null);
    setAdvisorMessages([]);
    advisorInitRef.current = false;
    history.replaceState(null, "", "/");
  };

  return (
    <div className="min-h-dvh text-white">
      {currentView === "input" && (
        <BrainDumpPage
          onSubmit={handleBrainDumpSubmit}
          isLoading={isLoading}
        />
      )}
      {currentView === "chat" && (
        <ChatPage
          rawText={rawText}
          profile={profile}
          followUpRounds={followUpRounds}
          currentRound={currentRound}
          isLoading={isLoading}
          error={error}
          onActivitiesParsed={handleActivitiesParsed}
          onFollowUpComplete={handleFollowUpComplete}
          onGenerateProfile={handleGenerateProfile}
          setIsLoading={setIsLoading}
          setError={setError}
        />
      )}
      {currentView === "goals" && (
        <GoalSetupPage onComplete={handleGoalsComplete} />
      )}
      {currentView === "profile" && (
        <ProfilePage
          profile={profile}
          onEditActivity={handleEditActivity}
          onAddActivities={handleAddActivities}
          onStartOver={handleStartOver}
          setIsLoading={setIsLoading}
          setError={setError}
          isLoading={isLoading}
          error={error}
          advisorMessages={advisorMessages}
          onAdvisorMessage={handleAdvisorMessage}
          advisorLoading={advisorLoading}
          refreshingAnalysis={refreshingAnalysis}
          onAdvisorTabOpened={handleAdvisorTabOpened}
          onNewConversation={handleNewConversation}
          profileId={profileId}
          onLoadConversation={handleLoadConversation}
          onBackToCurrent={handleBackToCurrent}
          onDeleteConversation={handleDeleteConversation}
          conversations={conversations}
          onListConversations={handleListConversations}
          isViewingPrevious={conversationId !== latestConvId}
          onDiscussStrategy={handleDiscussStrategy}
          onAppHelperSessionsChanged={(sessions) => {
            setProfile((prev) => {
              const next = { ...prev, appHelperSessions: sessions, lastUpdated: new Date() };
              if (profileId) {
                try { localStorage.setItem(`kairo_profile_${profileId}`, JSON.stringify(next)); } catch {}
                updateProfile(profileId, next).catch(console.error);
              }
              return next;
            });
          }}
        />
      )}
      <Analytics />
    </div>
  );
}

export default App;
