import { useState } from "react";
import { ApiError } from "../api/client.js";
import { useSettings } from "../hooks/useSettings.js";

const ALLOWED_MODELS = ["claude-opus-4-7", "claude-sonnet-4-6"] as const;

/**
 * Open-source single-user settings page.
 *
 * Two ways to drive `/query`:
 *   • "api"  — server reads ANTHROPIC_API_KEY from its env (banner reminds
 *              the deployer to set it).
 *   • "cli"  — server shells out to the local `claude` binary, which reads
 *              its credentials from the OS keychain (via `claude auth login`).
 *              No env var required.
 */
export function Settings() {
  const s = useSettings();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onChangeModel = async (model: string) => {
    setPending(true);
    setError(null);
    try {
      await s.setDefaultModel(model);
    } catch (err) {
      setError(err instanceof ApiError ? `HTTP ${err.status}` : String(err));
    } finally {
      setPending(false);
    }
  };

  const onChangeMode = async (mode: string) => {
    setPending(true);
    setError(null);
    try {
      await s.setDefaultMode(mode);
    } catch (err) {
      setError(err instanceof ApiError ? `HTTP ${err.status}` : String(err));
    } finally {
      setPending(false);
    }
  };

  if (s.loading) return <main className="route-loading">Loading settings…</main>;

  const showApiKeyBanner = s.defaultMode === "api" && !s.apiKeyConfigured;

  return (
    <main className="settings-page">
      <h2>Settings</h2>

      {showApiKeyBanner && (
        <div className="settings-banner" role="alert" data-testid="api-key-banner">
          <strong>ANTHROPIC_API_KEY is not set on the server.</strong> Restart
          the server with the env var (e.g. <code>export ANTHROPIC_API_KEY=sk-…</code>)
          to enable Claude, or switch the mode below to <em>Claude CLI</em> if
          you have <code>claude auth login</code> configured locally.
          Templates can still be created and edited locally.
        </div>
      )}

      <section className="settings-section">
        <h3>Mode</h3>
        <p>How the server reaches Claude.</p>
        <label>
          <input
            type="radio"
            name="settings-mode"
            value="cli"
            checked={s.defaultMode === "cli"}
            disabled={pending}
            onChange={() => void onChangeMode("cli")}
          />
          Claude CLI (uses local <code>claude</code> binary &amp; <code>claude auth login</code>)
        </label>
        <label>
          <input
            type="radio"
            name="settings-mode"
            value="api"
            checked={s.defaultMode === "api"}
            disabled={pending}
            onChange={() => void onChangeMode("api")}
          />
          API key (uses <code>ANTHROPIC_API_KEY</code> on the server)
        </label>
      </section>

      <section className="settings-section">
        <h3>Model</h3>
        <label htmlFor="settings-model">Default Claude model</label>
        <select
          id="settings-model"
          value={s.defaultModel}
          disabled={pending}
          onChange={(e) => void onChangeModel(e.target.value)}
        >
          {ALLOWED_MODELS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        {error && <p className="settings-error" role="alert">{error}</p>}
      </section>

      <section className="settings-section">
        <h3>Provider</h3>
        <p>{s.defaultProvider}</p>
      </section>
    </main>
  );
}
