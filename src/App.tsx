import { useState, useEffect, useRef, useCallback } from "react";
import type { AppView } from "./types/profile";
import type { ParsedActivity } from "./types/activity";
import type { FollowUpRound, StudentProfile } from "./types/profile";
import BrainDumpPage from "./pages/BrainDumpPage";
import ChatPage from "./pages/ChatPage";
import ProfilePage from "./pages/ProfilePage";
import { createProfile, updateProfile, loadProfile } from "./lib/profileApi";

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
    setCurrentView("profile");
    try {
      const id = await createProfile(profile);
      setProfileId(id);
      history.replaceState(null, "", "?p=" + id);
    } catch (err) {
      console.error("Failed to save profile:", err);
    }
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
        activities: [...prev.activities, ...newActivities],
        lastUpdated: new Date(),
      };
      if (profileId) debouncedSave(profileId, next);
      return next;
    });
  };

  const handleStartOver = () => {
    setCurrentView("input");
    setRawText("");
    setProfile({ activities: [], lastUpdated: new Date() });
    setFollowUpRounds([]);
    setCurrentRound(0);
    setError(null);
    setProfileId(null);
    history.replaceState(null, "", "/");
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
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
        />
      )}
    </div>
  );
}

export default App;
