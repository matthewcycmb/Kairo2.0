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
      // Check if user is responding to an action item follow-up
      const lowerText = userText.toLowerCase();
      const isCompletionResponse = lowerText.includes("yes i did it") || lowerText.includes("i completed");

      const pendingActions = actionItems.filter((i) => i.status === "pending");

      // If "Yes I did it" → mark most recent pending action as completed
      let updatedItems = [...actionItems];
      if (isCompletionResponse && pendingActions.length > 0) {
        const completedItem = pendingActions[pendingActions.length - 1];
        updatedItems = updatedItems.map((item) =>
          item.id === completedItem.id
            ? { ...item, status: "completed" as const, completedAt: new Date().toISOString() }
            : item
        );
        setActionItems(updatedItems);

        // Persist completion to Supabase
        if (profileId) {
          updateActionItem(profileId, completedItem.id, { status: "completed" }).catch(console.error);
        }
      }

      const currentPending = updatedItems.filter((i) => i.status === "pending");

      const response = await callApi({
        type: "advisor",
        profile,
        messages: updatedMessages,
        isFirstMessage: false,
        pendingActions: currentPending,
      });

      const assistantMsg: AdvisorMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: response.message,
        timestamp: new Date().toISOString(),
        suggestions: response.suggestions,
      };

      const allMessages = [...updatedMessages, assistantMsg];
      setAdvisorMessages(allMessages);

      // Only add new action items if all pending items are resolved
      const stillPending = updatedItems.filter((i) => i.status === "pending");
      const finalItems = stillPending.length === 0
        ? addNewActionItems(response.actionItems, updatedItems)
        : updatedItems;
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

      // Fallback: migrate old-format action items from profile blob
      if (loadedItems.length === 0 && actionItems.length > 0) {
        loadedItems = actionItems.map((item) => ({
          ...item,
          status: ("status" in item ? item.status : ("completed" in item && (item as unknown as { completed: boolean }).completed) ? "completed" : "pending") as "pending" | "completed",
          createdAt: item.createdAt || new Date().toISOString(),
        }));
      }

      // Step 2: Check for pending action items — this is the FIRST check
      const pendingActions = loadedItems.filter((i) => i.status === "pending");

      if (pendingActions.length > 0) {
        // Return visit with pending items → follow-up, NOT fresh analysis
        if (loadedMessages.length > 0) {
          setAdvisorMessages(loadedMessages);
        }
        setActionItems(loadedItems);

        const mostRecentAction = pendingActions[pendingActions.length - 1];

        const followUpContent = pendingActions.length > 1
          ? `The student is returning. They have ${pendingActions.length} pending action items:\n${pendingActions.map((a) => `- "${a.action}"`).join("\n")}\nAsk which ones they've made progress on. Keep it short and friendly — 2-3 sentences max.`
          : `The student is returning. Their pending action is: "${mostRecentAction.action}" (addresses: ${mostRecentAction.gap}). Ask if they've done it yet. Keep it short and friendly — 2-3 sentences max.`;

        const followUpUserMsg: AdvisorMessage = {
          id: `msg_${Date.now()}_system`,
          role: "user",
          content: followUpContent,
          timestamp: new Date().toISOString(),
        };

        const response = await callApi({
          type: "advisor",
          profile,
          messages: [...(loadedMessages.length > 0 ? loadedMessages.slice(-10) : []), followUpUserMsg],
          isFirstMessage: false,
          pendingActions,
        });

        const welcomeBackMsg: AdvisorMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: response.message,
          timestamp: new Date().toISOString(),
          suggestions: ["Yes I did it", "Not yet"],
        };

        const allMessages = loadedMessages.length > 0
          ? [...loadedMessages, welcomeBackMsg]
          : [welcomeBackMsg];
        setAdvisorMessages(allMessages);

        if (profileId) {
          await saveAdvisorMessages(profileId, [welcomeBackMsg]).catch(console.error);
        }
        return;
      }

      // Step 3: If messages exist but no pending items → show existing messages
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
        ...(response.analysis && { analysis: response.analysis }),
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
          onAdvisorTabOpened={handleAdvisorTabOpened}
          actionItems={actionItems}
          onToggleActionItem={handleToggleActionItem}
          profileId={profileId}
        />
      )}
      <Analytics />
    </div>
  );
}

export default App;
