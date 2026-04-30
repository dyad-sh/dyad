// UserProfileFull.tsx — full-featured user profile page component

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  fetchUser,
  updateUser,
  uploadAvatar,
  fetchUserActivity,
} from "../services/userService";
import type { User, ActivityItem } from "../types";

interface UserProfileFullProps {
  userId?: string;
  showStats?: boolean;
  showActivity?: boolean;
}

interface StatCard {
  label: string;
  value: number | string;
  change?: number;
  unit?: string;
}

// ── Types for internal state ──────────────────────────────────

interface AvatarState {
  url: string | null;
  uploading: boolean;
  error: string | null;
  previewUrl: string | null;
}

interface StatsState {
  cards: StatCard[];
  loading: boolean;
  error: string | null;
  period: "week" | "month" | "year";
}

interface ActivityState {
  items: ActivityItem[];
  loading: boolean;
  error: string | null;
  page: number;
  hasMore: boolean;
}

// ── Utility functions ─────────────────────────────────────────

function formatStatValue(value: number | string, unit?: string): string {
  if (typeof value === "number") {
    const formatted =
      value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
    return unit ? `${formatted} ${unit}` : formatted;
  }
  return value;
}

function getChangeClass(change: number | undefined): string {
  if (!change) return "stat-change--neutral";
  return change > 0 ? "stat-change--positive" : "stat-change--negative";
}

function formatChangePercent(change: number | undefined): string {
  if (!change) return "—";
  const sign = change > 0 ? "+" : "";
  return `${sign}${change.toFixed(1)}%`;
}

function formatActivityDate(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function getActivityIcon(type: string): string {
  switch (type) {
    case "commit":
      return "📝";
    case "review":
      return "👀";
    case "merge":
      return "🔀";
    case "comment":
      return "💬";
    case "deploy":
      return "🚀";
    default:
      return "📌";
  }
}

// ── Main component ────────────────────────────────────────────

export function UserProfile({
  userId: propUserId,
  showStats = true,
  showActivity = true,
}: UserProfileFullProps) {
  const { id: paramUserId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const resolvedUserId = propUserId ?? paramUserId ?? "";

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<User>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Avatar state and logic ──────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatar, setAvatar] = useState<AvatarState>({
    url: null,
    uploading: false,
    error: null,
    previewUrl: null,
  });

  const handleAvatarClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleAvatarSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        setAvatar((prev) => ({
          ...prev,
          error: "Please select an image file",
        }));
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        setAvatar((prev) => ({ ...prev, error: "Image must be under 5MB" }));
        return;
      }

      const previewUrl = URL.createObjectURL(file);
      setAvatar((prev) => ({
        ...prev,
        previewUrl,
        uploading: true,
        error: null,
      }));

      try {
        const result = await uploadAvatar(resolvedUserId, file);
        setAvatar({
          url: result.url,
          uploading: false,
          error: null,
          previewUrl: null,
        });
        URL.revokeObjectURL(previewUrl);
      } catch (err) {
        setAvatar((prev) => ({
          ...prev,
          uploading: false,
          error: err instanceof Error ? err.message : "Upload failed",
        }));
        URL.revokeObjectURL(previewUrl);
      }
    },
    [resolvedUserId],
  );

  const handleAvatarRemove = useCallback(() => {
    setAvatar({ url: null, uploading: false, error: null, previewUrl: null });
  }, []);

  const avatarDisplayUrl =
    avatar.previewUrl ?? avatar.url ?? "/default-avatar.png";

  const renderAvatarBadge = useCallback(() => {
    if (avatar.uploading) {
      return <span className="avatar-badge avatar-badge--uploading">⏳</span>;
    }
    if (avatar.error) {
      return <span className="avatar-badge avatar-badge--error">⚠️</span>;
    }
    return null;
  }, [avatar.uploading, avatar.error]);

  // ── Load user data ──────────────────────────────────────────

  const loadUser = useCallback(async () => {
    if (!resolvedUserId) return;
    setLoading(true);
    setError(null);
    try {
      const userData = await fetchUser(resolvedUserId);
      setUser(userData);
      setAvatar((prev) => ({ ...prev, url: userData.avatarUrl ?? null }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load user");
    } finally {
      setLoading(false);
    }
  }, [resolvedUserId]);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  // ── Edit handlers ───────────────────────────────────────────

  const handleEdit = useCallback(() => {
    if (user) {
      setEditing(true);
      setDraft({ ...user });
      setSaveError(null);
    }
  }, [user]);

  const handleCancel = useCallback(() => {
    setEditing(false);
    setDraft({});
    setSaveError(null);
  }, []);

  const handleFieldChange = useCallback((field: keyof User, value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await updateUser(resolvedUserId, draft);
      setUser(updated);
      setEditing(false);
      setDraft({});
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [resolvedUserId, draft]);

  // ── Stats state and logic ───────────────────────────────────
  const INITIAL_STATS_PERIOD: "week" | "month" | "year" = "month";
  const [stats, setStats] = useState<StatsState>({
    cards: [],
    loading: true,
    error: null,
    period: INITIAL_STATS_PERIOD,
  });

  const loadStats = useCallback(async (period: "week" | "month" | "year") => {
    setStats((prev) => ({ ...prev, loading: true, error: null, period }));
    try {
      // Simulate loading stats — in production this hits the analytics API
      await new Promise((r) => setTimeout(r, 100));
      const mockCards: StatCard[] = [
        {
          label: "Commits",
          value: period === "week" ? 23 : period === "month" ? 87 : 1042,
          change: 12.5,
        },
        {
          label: "PRs Merged",
          value: period === "week" ? 5 : period === "month" ? 18 : 203,
          change: -3.2,
        },
        {
          label: "Reviews",
          value: period === "week" ? 11 : period === "month" ? 42 : 498,
          change: 8.1,
        },
        {
          label: "Lines Changed",
          value: period === "week" ? 1250 : period === "month" ? 4800 : 58000,
          unit: "lines",
          change: 15.7,
        },
        {
          label: "Issues Closed",
          value: period === "week" ? 7 : period === "month" ? 25 : 312,
          change: 0,
        },
        { label: "Build Success", value: "98.2%", change: 1.1 },
      ];
      setStats({ cards: mockCards, loading: false, error: null, period });
    } catch (err) {
      setStats((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to load stats",
      }));
    }
  }, []);

  useEffect(() => {
    if (showStats && resolvedUserId) {
      loadStats(INITIAL_STATS_PERIOD);
    }
  }, [showStats, resolvedUserId, loadStats]);

  const handlePeriodChange = useCallback(
    (period: "week" | "month" | "year") => {
      loadStats(period);
    },
    [loadStats],
  );

  const statsGridColumns = useMemo(() => {
    return stats.cards.length <= 3 ? "stats-grid--2col" : "stats-grid--3col";
  }, [stats.cards.length]);

  const totalCommits = useMemo(() => {
    const commitCard = stats.cards.find((c) => c.label === "Commits");
    return typeof commitCard?.value === "number" ? commitCard.value : 0;
  }, [stats.cards]);

  const renderStatCard = useCallback((card: StatCard, index: number) => {
    return (
      <div key={index} className="stat-card">
        <div className="stat-card__label">{card.label}</div>
        <div className="stat-card__value">
          {formatStatValue(card.value, card.unit)}
        </div>
        <div className={`stat-card__change ${getChangeClass(card.change)}`}>
          {formatChangePercent(card.change)}
        </div>
      </div>
    );
  }, []);

  const renderStatsHeader = useCallback(() => {
    const periods: Array<"week" | "month" | "year"> = ["week", "month", "year"];
    return (
      <div className="stats-header">
        <h2 className="stats-header__title">Performance Stats</h2>
        <div className="stats-header__periods">
          {periods.map((p) => (
            <button
              key={p}
              className={`period-btn ${stats.period === p ? "period-btn--active" : ""}`}
              onClick={() => handlePeriodChange(p)}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>
    );
  }, [stats.period, handlePeriodChange]);

  const renderStatsSummary = useCallback(() => {
    if (totalCommits === 0) return null;
    return (
      <div className="stats-summary">
        <p>
          Total activity: <strong>{totalCommits}</strong> commits this{" "}
          {stats.period}.
        </p>
      </div>
    );
  }, [totalCommits, stats.period]);

  // ── Activity feed state and logic ───────────────────────────
  const [activityState, setActivityState] = useState<ActivityState>({
    items: [],
    loading: true,
    error: null,
    page: 1,
    hasMore: true,
  });

  const loadActivity = useCallback(
    async (page: number, append = false) => {
      setActivityState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const items = await fetchUserActivity(resolvedUserId, page);
        setActivityState((prev) => ({
          items: append ? [...prev.items, ...items] : items,
          loading: false,
          error: null,
          page,
          hasMore: items.length >= 20,
        }));
      } catch (err) {
        setActivityState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : "Failed to load activity",
        }));
      }
    },
    [resolvedUserId],
  );

  useEffect(() => {
    if (showActivity && resolvedUserId) {
      loadActivity(1);
    }
  }, [showActivity, resolvedUserId, loadActivity]);

  const handleLoadMore = useCallback(() => {
    loadActivity(activityState.page + 1, true);
  }, [loadActivity, activityState.page]);

  const groupedActivity = useMemo(() => {
    const groups: Record<string, ActivityItem[]> = {};
    for (const item of activityState.items) {
      const dateKey = new Date(item.timestamp).toLocaleDateString();
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(item);
    }
    return groups;
  }, [activityState.items]);

  const renderActivityItem = useCallback(
    (item: ActivityItem) => {
      return (
        <div key={item.id} className="activity-item">
          <span className="activity-item__icon">
            {getActivityIcon(item.type)}
          </span>
          <div className="activity-item__content">
            <p className="activity-item__description">{item.description}</p>
            <span className="activity-item__time">
              {formatActivityDate(item.timestamp)}
            </span>
            {item.metadata?.pr && (
              <a
                className="activity-item__link"
                href={`/pr/${item.metadata.pr}`}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(`/pr/${item.metadata!.pr}`);
                }}
              >
                PR #{item.metadata.pr}
              </a>
            )}
          </div>
        </div>
      );
    },
    [navigate],
  );

  const renderActivityGroup = useCallback(
    (dateKey: string, items: ActivityItem[]) => {
      return (
        <div key={dateKey} className="activity-group">
          <h3 className="activity-group__date">{dateKey}</h3>
          <div className="activity-group__items">
            {items.map((item) => renderActivityItem(item))}
          </div>
        </div>
      );
    },
    [renderActivityItem],
  );

  const renderActivityEmpty = useCallback(() => {
    return (
      <div className="activity-empty">
        <p>No recent activity to show.</p>
      </div>
    );
  }, []);

  const renderActivityError = useCallback(() => {
    return (
      <div className="activity-error">
        <p>{activityState.error}</p>
        <button onClick={() => loadActivity(1)}>Retry</button>
      </div>
    );
  }, [activityState.error, loadActivity]);

  // ── Loading / error states ──────────────────────────────────

  if (loading) {
    return (
      <div className="profile-loading">
        <div className="spinner" />
        <p>Loading profile…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="profile-error">
        <p>{error}</p>
        <button onClick={loadUser}>Retry</button>
        <button onClick={() => navigate(-1)}>Go Back</button>
      </div>
    );
  }

  if (!user) return null;

  // ── Render ──────────────────────────────────────────────────

  return (
    <div className="user-profile">
      <header className="user-profile__header">
        <button className="back-btn" onClick={() => navigate(-1)}>
          ← Back
        </button>
        <h1>{user.name}'s Profile</h1>
      </header>

      {/* ── Avatar section ────────────────────────────────── */}
      <section className="avatar-section">
        <div className="avatar-container" onClick={handleAvatarClick}>
          <img
            src={avatarDisplayUrl}
            alt={`${user.name}'s avatar`}
            className={`avatar-image ${avatar.uploading ? "avatar-image--uploading" : ""}`}
          />
          {renderAvatarBadge()}
          <div className="avatar-overlay">
            <span>Change Photo</span>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="avatar-input"
          onChange={handleAvatarSelect}
        />
        {avatar.url && (
          <button className="avatar-remove-btn" onClick={handleAvatarRemove}>
            Remove Photo
          </button>
        )}
        {avatar.error && <p className="avatar-error">{avatar.error}</p>}
        <div className="avatar-info">
          <h2>{user.name}</h2>
          <p className="avatar-info__role">{user.role}</p>
          <p className="avatar-info__email">{user.email}</p>
          <p className="avatar-info__joined">
            Member since {new Date(user.createdAt).toLocaleDateString()}
          </p>
        </div>
      </section>

      {/* ── Profile edit form ─────────────────────────────── */}
      {editing ? (
        <section className="edit-section">
          <h2>Edit Profile</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSave();
            }}
          >
            <div className="form-field">
              <label htmlFor="edit-name">Name</label>
              <input
                id="edit-name"
                value={draft.name ?? ""}
                onChange={(e) => handleFieldChange("name", e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="edit-email">Email</label>
              <input
                id="edit-email"
                type="email"
                value={draft.email ?? ""}
                onChange={(e) => handleFieldChange("email", e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="edit-bio">Bio</label>
              <textarea
                id="edit-bio"
                value={draft.bio ?? ""}
                onChange={(e) => handleFieldChange("bio", e.target.value)}
                rows={4}
              />
            </div>
            {saveError && <p className="form-error">{saveError}</p>}
            <div className="form-actions">
              <button
                type="submit"
                disabled={saving}
                className="btn btn--primary"
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={saving}
                className="btn btn--secondary"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      ) : (
        <section className="profile-details">
          <div className="profile-details__row">
            <strong>Email:</strong> <span>{user.email}</span>
          </div>
          <div className="profile-details__row">
            <strong>Role:</strong> <span>{user.role}</span>
          </div>
          <div className="profile-details__row">
            <strong>Bio:</strong> <span>{user.bio ?? "No bio provided"}</span>
          </div>
          <button onClick={handleEdit} className="btn btn--primary">
            Edit Profile
          </button>
        </section>
      )}

      {/* ── Stats panel ───────────────────────────────────── */}
      {showStats && (
        <section className="stats-panel">
          {renderStatsHeader()}
          {stats.loading ? (
            <div className="stats-loading">
              <div className="spinner spinner--small" />
              <p>Loading stats…</p>
            </div>
          ) : stats.error ? (
            <div className="stats-error">
              <p>{stats.error}</p>
              <button onClick={() => loadStats(stats.period)}>Retry</button>
            </div>
          ) : (
            <>
              <div className={`stats-grid ${statsGridColumns}`}>
                {stats.cards.map((card, i) => renderStatCard(card, i))}
              </div>
              {renderStatsSummary()}
            </>
          )}
        </section>
      )}

      {/* ── Activity feed ─────────────────────────────────── */}
      {showActivity && (
        <section className="activity-feed">
          <h2 className="activity-feed__title">Recent Activity</h2>
          {activityState.loading && activityState.items.length === 0 ? (
            <div className="activity-loading">
              <div className="spinner spinner--small" />
              <p>Loading activity…</p>
            </div>
          ) : activityState.error && activityState.items.length === 0 ? (
            renderActivityError()
          ) : activityState.items.length === 0 ? (
            renderActivityEmpty()
          ) : (
            <>
              {Object.entries(groupedActivity).map(([dateKey, items]) =>
                renderActivityGroup(dateKey, items),
              )}
              {activityState.hasMore && (
                <div className="activity-load-more">
                  <button
                    onClick={handleLoadMore}
                    disabled={activityState.loading}
                    className="btn btn--secondary"
                  >
                    {activityState.loading ? "Loading…" : "Load More"}
                  </button>
                </div>
              )}
              {activityState.error && (
                <div className="activity-inline-error">
                  <p>Failed to load more: {activityState.error}</p>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* ── Footer ────────────────────────────────────────── */}
      <footer className="user-profile__footer">
        <p>
          Profile last updated:{" "}
          {user.updatedAt ? new Date(user.updatedAt).toLocaleString() : "Never"}
        </p>
      </footer>
    </div>
  );
}
