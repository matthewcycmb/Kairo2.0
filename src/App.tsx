import { useState, useEffect, useRef, useCallback } from "react";
import type { AppView, AdvisorMessage, StudentGoals } from "./types/profile";
import type { ParsedActivity } from "./types/activity";
import type { FollowUpRound, StudentProfile } from "./types/profile";
import BrainDumpPage from "./pages/BrainDumpPage";
import ChatPage from "./pages/ChatPage";
import ProfilePage from "./pages/ProfilePage";
import GoalSetupPage from "./pages/GoalSetupPage";
import { createProfile, updateProfile, loadProfile } from "./lib/profileApi";
import { callApi } from "./lib/apiClient";

const initialProfileId = new URLSearchParams(window.location.search).get("p");

function App() {
  const [currentView, setCurrentView] = useState<AppView>(initialProfileId ? "loading" : "input");
  const [rawText, setRawText] = useState("");
  const [profile, setProfile] = useState<StudentProfile>({
    activities: [],
    lastUpdated: new Date(),
  });
  const [followUpRounds, setFollowUpRounds] = useState<FollowUpRound[]>([]);
  const [currentRound, setCurrentRound] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(initialProfileId);

  // Advisor state
  const [advisorMessages, setAdvisorMessages] = useState<AdvisorMessage[]>([]);
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const advisorInitRef = useRef(false);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedSave = useCallback(
    (id: string, data: StudentProfile) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
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

  const handleAdvisorMessage = async (userText: string) => {
    const userMsg: AdvisorMessage = {
      id: `msg_${Date.now()}_user`,
      role: "user",
      content: userText,
      timestamp: new Date().toISOString(),
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

      const assistantMsg: AdvisorMessage = {
        id: `msg_${Date.now()}_assistant`,
        role: "assistant",
        content: response.message,
        timestamp: new Date().toISOString(),
      };

      const allMessages = [...updatedMessages, assistantMsg];
      setAdvisorMessages(allMessages);

      // Persist to profile
      setProfile((prev) => {
        const next = { ...prev, advisorMessages: allMessages, lastUpdated: new Date() };
        if (profileId) debouncedSave(profileId, next);
        return next;
      });
    } catch (err) {
      console.error("Advisor error:", err);
      const errorMsg: AdvisorMessage = {
        id: `msg_${Date.now()}_error`,
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
    // Only auto-trigger first message once
    if (advisorMessages.length > 0 || advisorInitRef.current) return;
    advisorInitRef.current = true;

    setAdvisorLoading(true);

    try {
      const response = await callApi({
        type: "advisor",
        profile,
        messages: [],
        isFirstMessage: true,
      });

      const firstMsg: AdvisorMessage = {
        id: `msg_${Date.now()}_assistant`,
        role: "assistant",
        content: response.message,
        timestamp: new Date().toISOString(),
        ...(response.analysis && { analysis: response.analysis }),
      };

      setAdvisorMessages([firstMsg]);

      // Persist to profile
      setProfile((prev) => {
        const next = { ...prev, advisorMessages: [firstMsg], lastUpdated: new Date() };
        if (profileId) debouncedSave(profileId, next);
        return next;
      });
    } catch (err) {
      console.error("Advisor init error:", err);
      advisorInitRef.current = false; // Allow retry
    } finally {
      setAdvisorLoading(false);
    }
  };

  const handleStartOver = () => {
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
    <div className="min-h-screen text-white">
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
        />
      )}
    </div>
  );
}

export default App;
