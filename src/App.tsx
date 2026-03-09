import { useState, useEffect, useRef, useCallback } from "react";
import type { AppView, AdvisorMessage, ActionItem, StudentGoals } from "./types/profile";
import type { ParsedActivity } from "./types/activity";
import type { FollowUpRound, StudentProfile } from "./types/profile";
import BrainDumpPage from "./pages/BrainDumpPage";
import ChatPage from "./pages/ChatPage";
import ProfilePage from "./pages/ProfilePage";
import GoalSetupPage from "./pages/GoalSetupPage";
import { createProfile, updateProfile, loadProfile, saveAdvisorMessages, loadAdvisorMessages, saveActionItems, loadActionItems, updateActionItem } from "./lib/profileApi";
import { callApi } from "./lib/apiClient";
import { formatProfileAsText } from "./lib/profileUtils";
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
  const [refreshingProfile, setRefreshingProfile] = useState(false);
  const [actionItems, setActionItems] = useState<ActionItem[]>(cachedProfile?.actionItems || []);
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
          if (loaded.advisorMessages?.length) {
            setAdvisorMessages(loaded.advisorMessages);
          }
          if (loaded.actionItems?.length) {
            // Migrate old format: completed:boolean → status:'pending'|'completed'
            const migrated = loaded.actionItems.map((item) => ({
              ...item,
              status: ("status" in item ? item.status : ("completed" in item && (item as unknown as { completed: boolean }).completed) ? "completed" : "pending") as "pending" | "completed",
              createdAt: item.createdAt || new Date().toISOString(),
            }));
            setActionItems(migrated);
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

  const addNewActionItems = (
    items: { action: string; gap: string }[] | undefined,
    currentItems: ActionItem[]
  ): ActionItem[] => {
    if (!items || items.length === 0) return currentItems;
    const activeCount = currentItems.filter((i) => i.status === "pending").length;
    const room = 2 - activeCount;
    if (room <= 0) return currentItems;
    const newItems: ActionItem[] = items.slice(0, room).map((item) => ({
      id: crypto.randomUUID(),
      action: item.action,
      gap: item.gap,
      status: "pending" as const,
      createdAt: new Date().toISOString(),
    }));
    return [...currentItems, ...newItems];
  };

  const handleAdvisorMessage = async (userText: string) => {
    const userMsg: AdvisorMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: userText,
      timestamp: new Date().toISOString(),
    };

    const updatedMessages = [...advisorMessages, userMsg];
    setAdvisorMessages(updatedMessages);
    setAdvisorLoading(true);

    try {
      const updatedItems = [...actionItems];
      const currentPending = updatedItems.filter((i) => i.status === "pending");

      const response = await callApi({
        type: "advisor",
        profile,
        messages: updatedMessages,
        isFirstMessage: false,
        pendingActions: currentPending,
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
      };

      const allMessages = [...updatedMessages, assistantMsg];
      setAdvisorMessages(allMessages);

      // Add action items if room
      const finalItems = addNewActionItems(response.actionItems, updatedItems);
      setActionItems(finalItems);

      // Persist to Supabase — await so data is saved reliably
      if (profileId) {
        const newItems = finalItems.filter((item) => !updatedItems.some((old) => old.id === item.id));
        await Promise.all([
          saveAdvisorMessages(profileId, [userMsg, assistantMsg]).catch(console.error),
          newItems.length > 0
            ? saveActionItems(profileId, newItems).catch(console.error)
            : Promise.resolve(),
        ]);
      }

      // Also persist to profile blob immediately
      setProfile((prev) => {
        const next = { ...prev, advisorMessages: allMessages, actionItems: finalItems, lastUpdated: new Date() };
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
        content: "Sorry, I had trouble responding. Try again in a moment.",
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

    setAdvisorLoading(true);

    try {
      // Step 1: Load from Supabase
      let loadedMessages: AdvisorMessage[] = [];
      let loadedItems: ActionItem[] = [];

      if (profileId) {
        try {
          const [msgs, items] = await Promise.all([
            loadAdvisorMessages(profileId),
            loadActionItems(profileId),
          ]);
          loadedMessages = msgs;
          loadedItems = items;
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
      if (loadedItems.length === 0 && actionItems.length > 0) {
        loadedItems = actionItems.map((item) => ({
          ...item,
          status: ("status" in item ? item.status : ("completed" in item && (item as unknown as { completed: boolean }).completed) ? "completed" : "pending") as "pending" | "completed",
          createdAt: item.createdAt || new Date().toISOString(),
        }));
        if (profileId && loadedItems.length > 0) {
          saveActionItems(profileId, loadedItems).catch(console.error);
        }
      }

      // Step 2: If messages exist → restore history
      if (loadedMessages.length > 0) {
        setAdvisorMessages(loadedMessages);
        setActionItems(loadedItems);
        return;
      }

      // Step 4: No messages AND no pending items → fresh analysis
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
      };

      setAdvisorMessages([firstMsg]);

      const updatedItems = addNewActionItems(response.actionItems, loadedItems);
      setActionItems(updatedItems);

      // Persist to Supabase — await so data is saved before user can close tab
      if (profileId) {
        await Promise.all([
          saveAdvisorMessages(profileId, [firstMsg]).catch(console.error),
          updatedItems.length > 0
            ? saveActionItems(profileId, updatedItems).catch(console.error)
            : Promise.resolve(),
        ]);
      }

      // Also persist to profile blob immediately (no debounce)
      setProfile((prev) => {
        const next = { ...prev, advisorMessages: [firstMsg], actionItems: updatedItems, lastUpdated: new Date() };
        if (profileId) {
          try { localStorage.setItem(`kairo_profile_${profileId}`, JSON.stringify(next)); } catch {}
          updateProfile(profileId, next).catch(console.error);
        }
        return next;
      });
    } catch (err) {
      console.error("Advisor init error:", err);
      advisorInitRef.current = false; // Allow retry
    } finally {
      setAdvisorLoading(false);
    }
  };

  const handleToggleActionItem = (itemId: string) => {
    setActionItems((prev) => {
      const updated = prev.map((item) => {
        if (item.id !== itemId) return item;
        const newStatus = item.status === "pending" ? "completed" as const : "pending" as const;
        return {
          ...item,
          status: newStatus,
          completedAt: newStatus === "completed" ? new Date().toISOString() : undefined,
        };
      });
      // Persist to Supabase
      const toggled = updated.find((i) => i.id === itemId);
      if (profileId && toggled) {
        updateActionItem(profileId, itemId, { status: toggled.status }).catch(console.error);
      }
      // Persist to profile blob
      setProfile((p) => {
        const next = { ...p, actionItems: updated, lastUpdated: new Date() };
        if (profileId) debouncedSave(profileId, next);
        return next;
      });
      return updated;
    });
  };

  const handleRefreshAnalysis = async () => {
    setRefreshingAnalysis(true);
    try {
      const response = await callApi({
        type: "advisor",
        profile,
        messages: [],
        isFirstMessage: true,
      });

      const newAnalysisMsg: AdvisorMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: response.message,
        timestamp: new Date().toISOString(),
        suggestions: response.suggestions,
      };

      // Replace the first assistant message (the opening analysis), keep the rest
      const rest = advisorMessages.slice(1);
      const allMessages = [newAnalysisMsg, ...rest];
      setAdvisorMessages(allMessages);

      const updatedItems = addNewActionItems(response.actionItems, actionItems);
      setActionItems(updatedItems);

      if (profileId) {
        await saveAdvisorMessages(profileId, [newAnalysisMsg]).catch(console.error);
      }

      setProfile((prev) => {
        const next = { ...prev, advisorMessages: allMessages, actionItems: updatedItems, lastUpdated: new Date() };
        if (profileId) {
          try { localStorage.setItem(`kairo_profile_${profileId}`, JSON.stringify(next)); } catch {}
          updateProfile(profileId, next).catch(console.error);
        }
        return next;
      });
    } catch (err) {
      console.error("Refresh analysis error:", err);
    } finally {
      setRefreshingAnalysis(false);
    }
  };

  const handleRefreshProfile = async () => {
    setRefreshingProfile(true);
    try {
      const text = formatProfileAsText(profile);
      const response = await callApi({ type: "parse", text });
      const refreshed = {
        ...profile,
        activities: response.activities,
        lastUpdated: new Date(),
      };
      setProfile(refreshed);
      if (profileId) {
        try { localStorage.setItem(`kairo_profile_${profileId}`, JSON.stringify(refreshed)); } catch {}
        await updateProfile(profileId, refreshed);
      }
    } catch (err) {
      console.error("Refresh profile error:", err);
    } finally {
      setRefreshingProfile(false);
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
    setActionItems([]);
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
          onRefreshAnalysis={handleRefreshAnalysis}
          actionItems={actionItems}
          onToggleActionItem={handleToggleActionItem}
          profileId={profileId}
          onRefreshProfile={handleRefreshProfile}
          refreshingProfile={refreshingProfile}
        />
      )}
      <Analytics />
    </div>
  );
}

export default App;
