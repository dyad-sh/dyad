// UserProfile.tsx — class-based user profile component

import React from "react";
import {
  fetchUser,
  updateUser,
  fetchUserActivity,
} from "../services/userService";
import type { User, ActivityEntry } from "../types";

interface Props {
  userId: string;
  onProfileUpdated?: (user: User) => void;
  readOnly?: boolean;
}

interface State {
  user: User | null;
  loading: boolean;
  editing: boolean;
  draft: Partial<User>;
  error: string | null;
  saveError: string | null;
  saving: boolean;
  activity: ActivityEntry[];
  activityLoading: boolean;
  activityError: string | null;
  showActivity: boolean;
  uploadingAvatar: boolean;
  avatarError: string | null;
}

export class UserProfile extends React.Component<Props, State> {
  private avatarInputRef = React.createRef<HTMLInputElement>();

  constructor(props: Props) {
    super(props);
    this.state = {
      user: null,
      loading: true,
      editing: false,
      draft: {},
      error: null,
      saveError: null,
      saving: false,
      activity: [],
      activityLoading: false,
      activityError: null,
      showActivity: false,
      uploadingAvatar: false,
      avatarError: null,
    };
  }

  async componentDidMount() {
    await this.loadUser();
  }

  async componentDidUpdate(prevProps: Props) {
    if (prevProps.userId !== this.props.userId) {
      this.setState({
        editing: false,
        draft: {},
        saveError: null,
        activity: [],
        showActivity: false,
      });
      await this.loadUser();
    }
  }

  componentWillUnmount() {
    // Clean up any pending state updates
  }

  async loadUser() {
    this.setState({ loading: true, error: null });
    try {
      const user = await fetchUser(this.props.userId);
      this.setState({ user, loading: false });
    } catch (err) {
      this.setState({
        error: err instanceof Error ? err.message : "Failed to load user",
        loading: false,
      });
    }
  }

  async loadActivity() {
    this.setState({ activityLoading: true, activityError: null });
    try {
      const activity = await fetchUserActivity(this.props.userId);
      this.setState({ activity, activityLoading: false });
    } catch (err) {
      this.setState({
        activityError:
          err instanceof Error ? err.message : "Failed to load activity",
        activityLoading: false,
      });
    }
  }

  handleEdit = () => {
    this.setState({
      editing: true,
      draft: { ...this.state.user },
      saveError: null,
    });
  };

  handleCancel = () => {
    this.setState({ editing: false, draft: {}, saveError: null });
  };

  handleChange = (field: keyof User, value: string) => {
    this.setState((prev) => ({ draft: { ...prev.draft, [field]: value } }));
  };

  handleSave = async () => {
    this.setState({ saving: true, saveError: null });
    try {
      const updated = await updateUser(this.props.userId, this.state.draft);
      this.setState({
        user: updated,
        editing: false,
        draft: {},
        saving: false,
      });
      this.props.onProfileUpdated?.(updated);
    } catch (err) {
      this.setState({
        saveError:
          err instanceof Error ? err.message : "Failed to save changes",
        saving: false,
      });
    }
  };

  handleToggleActivity = async () => {
    const { showActivity, activity } = this.state;
    if (!showActivity && activity.length === 0) {
      await this.loadActivity();
    }
    this.setState((prev) => ({ showActivity: !prev.showActivity }));
  };

  handleAvatarClick = () => {
    this.avatarInputRef.current?.click();
  };

  handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      this.setState({ avatarError: "Avatar must be under 5 MB" });
      return;
    }

    this.setState({ uploadingAvatar: true, avatarError: null });
    try {
      // Upload stub — real impl would POST to /api/avatars
      await new Promise((r) => setTimeout(r, 500));
      const fakeUrl = URL.createObjectURL(file);
      const updated = await updateUser(this.props.userId, {
        avatarUrl: fakeUrl,
      });
      this.setState({ user: updated, uploadingAvatar: false });
    } catch (err) {
      this.setState({
        avatarError:
          err instanceof Error ? err.message : "Failed to upload avatar",
        uploadingAvatar: false,
      });
    }
  };

  renderActivityFeed() {
    const { activity, activityLoading, activityError } = this.state;

    if (activityLoading) {
      return <p className="activity-loading">Loading activity…</p>;
    }
    if (activityError) {
      return <p className="activity-error">{activityError}</p>;
    }
    if (activity.length === 0) {
      return <p className="activity-empty">No recent activity.</p>;
    }
    return (
      <ul className="activity-list">
        {activity.map((entry) => (
          <li key={entry.id} className="activity-entry">
            <span className="activity-action">{entry.action}</span>
            <span className="activity-time">
              {new Date(entry.timestamp).toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    );
  }

  render() {
    const {
      user,
      loading,
      editing,
      draft,
      error,
      saveError,
      saving,
      showActivity,
      uploadingAvatar,
      avatarError,
    } = this.state;
    const { readOnly } = this.props;

    if (loading) {
      return <div className="profile-loading">Loading profile…</div>;
    }

    if (error) {
      return (
        <div className="profile-error">
          <p>{error}</p>
          <button onClick={() => this.loadUser()}>Retry</button>
        </div>
      );
    }

    if (!user) return null;

    return (
      <div className="user-profile">
        <div className="profile-header">
          <div
            className="avatar-wrapper"
            onClick={!readOnly ? this.handleAvatarClick : undefined}
          >
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={`${user.name}'s avatar`}
                className="avatar"
              />
            ) : (
              <div className="avatar-placeholder">
                {user.name.charAt(0).toUpperCase()}
              </div>
            )}
            {!readOnly && (
              <div className="avatar-overlay">
                {uploadingAvatar ? "Uploading…" : "Change"}
              </div>
            )}
          </div>
          {!readOnly && (
            <input
              ref={this.avatarInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={this.handleAvatarChange}
            />
          )}
          {avatarError && <p className="avatar-error">{avatarError}</p>}
          <h1>{user.name}</h1>
          <span className={`role-badge role-badge--${user.role}`}>
            {user.role}
          </span>
        </div>

        {editing ? (
          <form
            className="profile-form"
            onSubmit={(e) => {
              e.preventDefault();
              this.handleSave();
            }}
          >
            <label>
              Name
              <input
                value={draft.name ?? ""}
                onChange={(e) => this.handleChange("name", e.target.value)}
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={draft.email ?? ""}
                onChange={(e) => this.handleChange("email", e.target.value)}
              />
            </label>
            <label>
              Bio
              <textarea
                value={draft.bio ?? ""}
                rows={4}
                onChange={(e) => this.handleChange("bio", e.target.value)}
              />
            </label>
            {saveError && <p className="error">{saveError}</p>}
            <div className="form-actions">
              <button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={this.handleCancel}
                disabled={saving}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="profile-view">
            <p>
              <strong>Email:</strong> {user.email}
            </p>
            <p>
              <strong>Role:</strong> {user.role}
            </p>
            {user.bio && (
              <p>
                <strong>Bio:</strong> {user.bio}
              </p>
            )}
            <p>
              <strong>Member since:</strong>{" "}
              {new Date(user.createdAt).toLocaleDateString()}
            </p>
            {!readOnly && (
              <button onClick={this.handleEdit}>Edit Profile</button>
            )}
          </div>
        )}

        <div className="activity-section">
          <button
            className="toggle-activity"
            onClick={this.handleToggleActivity}
          >
            {showActivity ? "Hide activity" : "Show recent activity"}
          </button>
          {showActivity && this.renderActivityFeed()}
        </div>
      </div>
    );
  }
}
