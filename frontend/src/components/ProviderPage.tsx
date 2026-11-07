import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import {
  api,
  ApiError,
  queryKeys,
  type ProviderConfig,
  type ProviderIn,
  type ProviderOut,
  type ProviderType,
  type ProviderTypeInfo,
  type TestResult,
} from "../api";
import { useProviderTypes, useRefreshProviders } from "../hooks";
import { formatTime, STATUS_LABEL, TEST_MESSAGE } from "../lib/providers";
import { navigate } from "../lib/route";
import { useUnsavedGuard } from "../lib/unsavedGuard";

/** The provider configuration page: `id` is `new` or the id of a saved configuration. */
export function ProviderPage({ id }: { id: string }) {
  const isNew = id === "new";
  const types = useProviderTypes();
  const provider = useQuery({
    queryKey: queryKeys.provider(id),
    queryFn: () => api.provider(id),
    enabled: !isNew,
  });

  if (types.isError || provider.isError) {
    const missing =
      provider.error instanceof ApiError && provider.error.status === 404;
    return (
      <section
        className="settings-page"
        aria-label={missing ? "Provider not found" : "Provider"}
      >
        <h1>
          {missing ? "Provider not found" : "Could not load the provider"}
        </h1>
        <p className="muted">
          {missing ? "It may have been deleted." : "Is the backend running?"}
        </p>
        <a href="#/settings">Back to providers</a>
      </section>
    );
  }
  if (!types.data || (!isNew && !provider.data))
    return <p className="page-status muted">Loading…</p>;
  return (
    <ProviderForm
      key={id}
      types={types.data}
      initial={isNew ? null : (provider.data ?? null)}
    />
  );
}

/** Form values are kept as the text of each input; they become numbers only when sent. */
interface FormState {
  type: ProviderType;
  name: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  temperature: string;
  maxTokens: string;
  topP: string;
  timeout: string;
  topK: string;
  frequencyPenalty: string;
  presencePenalty: string;
  stop: string;
  seed: string;
  responseFormat: "" | "text" | "json";
  contextWindow: string;
  extra: string;
  isActive: boolean;
}

const text = (n: number | undefined) => (n === undefined ? "" : String(n));

function fromProvider(p: ProviderOut): FormState {
  const c = p.config;
  return {
    type: p.provider_type,
    name: p.name,
    model: p.model_name,
    apiKey: "",
    baseUrl: p.base_url ?? "",
    temperature: text(c.temperature),
    maxTokens: text(c.max_tokens),
    topP: text(c.top_p),
    timeout: text(c.timeout),
    topK: text(c.top_k),
    frequencyPenalty: text(c.frequency_penalty),
    presencePenalty: text(c.presence_penalty),
    stop: (c.stop ?? []).join("\n"),
    seed: text(c.seed),
    responseFormat: c.response_format ?? "",
    contextWindow: text(c.context_window),
    extra:
      c.extra && Object.keys(c.extra).length > 0
        ? JSON.stringify(c.extra, null, 2)
        : "",
    isActive: p.is_active,
  };
}

function blankForm(types: ProviderTypeInfo[]): FormState {
  const first = types[0];
  return {
    type: first?.type ?? "openai",
    name: "",
    model: first?.models[0]?.id ?? "",
    apiKey: "",
    baseUrl: first?.default_base_url ?? "",
    temperature: "",
    maxTokens: "",
    topP: "",
    timeout: "",
    topK: "",
    frequencyPenalty: "",
    presencePenalty: "",
    stop: "",
    seed: "",
    responseFormat: "",
    contextWindow: "",
    extra: "",
    isActive: true,
  };
}

/** Numeric config fields: form key, config key and whether only whole numbers are valid. Each is sent only if the type supports it. */
const NUMBERS = [
  ["temperature", "temperature", false],
  ["maxTokens", "max_tokens", true],
  ["topP", "top_p", false],
  ["timeout", "timeout", true],
  ["topK", "top_k", true],
  ["frequencyPenalty", "frequency_penalty", false],
  ["presencePenalty", "presence_penalty", false],
  ["seed", "seed", true],
  ["contextWindow", "context_window", true],
] as const;

/** Field names the form shows an error under; any other error is shown at the top. */
const SHOWN_FIELDS = new Set([
  "name",
  "model_name",
  "api_key",
  "base_url",
  "provider_type",
  "extra",
  "response_format",
  "stop",
  ...NUMBERS.map((n) => n[1]),
]);
const ADVANCED_FIELDS = new Set([
  "top_k",
  "frequency_penalty",
  "presence_penalty",
  "stop",
  "seed",
  "response_format",
  "context_window",
  "extra",
]);

type Errors = Record<string, string>;

/** The request body, or the problems the browser can find before asking the server. */
function buildBody(
  form: FormState,
  info: ProviderTypeInfo | undefined,
): { body?: ProviderIn; errors: Errors } {
  const errors: Errors = {};
  const config: Record<string, unknown> = {};
  for (const [key, configKey, whole] of NUMBERS) {
    const raw = form[key].trim();
    if (!raw || !info?.params.includes(configKey)) continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) errors[configKey] = "Enter a number";
    else if (whole && !Number.isInteger(n))
      errors[configKey] = "Enter a whole number";
    else config[configKey] = n;
  }
  const stop = form.stop
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (stop.length > 0 && info?.params.includes("stop")) config.stop = stop;
  if (form.responseFormat && info?.params.includes("response_format"))
    config.response_format = form.responseFormat;
  if (form.extra.trim()) {
    try {
      const parsed: unknown = JSON.parse(form.extra);
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        errors.extra =
          'Provider-specific parameters must be a JSON object, like {"key": "value"}';
      } else config.extra = parsed;
    } catch {
      errors.extra = "Provider-specific parameters must be valid JSON";
    }
  }
  if (Object.keys(errors).length > 0) return { errors };
  const body: ProviderIn = {
    name: form.name.trim(),
    provider_type: form.type,
    model_name: form.model.trim(),
    is_active: form.isActive,
    config: config as ProviderConfig,
  };
  if (form.apiKey.trim()) body.api_key = form.apiKey.trim();
  if (form.baseUrl.trim()) body.base_url = form.baseUrl.trim();
  return { body, errors };
}

function Field({
  label,
  error,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  error?: string;
  hint?: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && (
        <span className="field-hint" id={`${htmlFor}-hint`}>
          {hint}
        </span>
      )}
      {error && (
        <span className="field-error" id={`${htmlFor}-error`} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

function ProviderForm({
  types,
  initial,
}: {
  types: ProviderTypeInfo[];
  initial: ProviderOut | null;
}) {
  const uid = useId();
  const refresh = useRefreshProviders();
  const [saved, setSaved] = useState<ProviderOut | null>(initial);
  const [form, setForm] = useState<FormState>(() =>
    initial ? fromProvider(initial) : blankForm(types),
  );
  const [baseline, setBaseline] = useState(() => JSON.stringify(form));
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [loadedModels, setLoadedModels] = useState<string[]>([]);
  const [modelsNote, setModelsNote] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const dirty = JSON.stringify(form) !== baseline;
  const { markClean } = useUnsavedGuard(dirty);
  const info = types.find((t) => t.type === form.type);
  const isAnthropic = form.type === "anthropic";
  const isClaudeCode = form.type === "claude-code";
  const keyHint = isClaudeCode
    ? "Optional: a token from `claude setup-token`. Without it, the machine's Claude Code login is used."
    : isAnthropic
      ? "An Anthropic API key (sk-ant-api…) or a token from `claude setup-token` (sk-ant-oat…). Line breaks from the terminal are removed."
      : info && !info.needs_key
        ? "Optional for this type."
        : undefined;
  const id = (name: string) => `${uid}-${name}`;
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setJustSaved(false);
    setForm((f) => ({ ...f, [key]: value }));
  };

  const pickType = (next: ProviderTypeInfo) => {
    setJustSaved(false);
    setForm((f) => {
      const previous = types.find((t) => t.type === f.type);
      const urlWasDefault =
        f.baseUrl === "" || f.baseUrl === (previous?.default_base_url ?? "");
      const modelWasPreset =
        f.model === "" || previous?.models.some((m) => m.id === f.model);
      return {
        ...f,
        type: next.type,
        baseUrl: urlWasDefault ? (next.default_base_url ?? "") : f.baseUrl,
        model: modelWasPreset ? (next.models[0]?.id ?? "") : f.model,
      };
    });
  };

  /** Shows the server's field errors under their fields; returns false when there were none. */
  const showServerErrors = (e: unknown, fallback: string): void => {
    if (e instanceof ApiError && e.status === 422 && e.fields.length > 0) {
      const next: Errors = {};
      const other: string[] = [];
      for (const f of e.fields) {
        if (SHOWN_FIELDS.has(f.field)) next[f.field] = f.msg;
        else other.push(`${f.field}: ${f.msg}`);
      }
      setErrors(next);
      setFormError(other.length > 0 ? other.join("; ") : null);
      if (Object.keys(next).some((k) => ADVANCED_FIELDS.has(k)))
        setAdvancedOpen(true);
      return;
    }
    if (e instanceof ApiError && e.status === 409) {
      setErrors({ name: e.message });
      setFormError(null);
      return;
    }
    setErrors({});
    setFormError(e instanceof Error ? e.message : fallback);
  };

  const validated = () => {
    const built = buildBody(form, info);
    setErrors(built.errors);
    setFormError(null);
    if (Object.keys(built.errors).some((k) => ADVANCED_FIELDS.has(k)))
      setAdvancedOpen(true);
    return built.body;
  };

  const save = async () => {
    const body = validated();
    if (!body) return;
    setBusy(true);
    setJustSaved(false);
    try {
      const out = saved
        ? await api.updateProvider(saved.id, body)
        : await api.createProvider(body);
      const next = { ...form, apiKey: "" };
      setSaved(out);
      setForm(next);
      setBaseline(JSON.stringify(next));
      setJustSaved(true);
      await refresh();
      if (!saved) {
        markClean();
        navigate({ page: "provider", id: out.id });
      }
    } catch (e) {
      showServerErrors(e, "Saving failed");
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setTestError(null);
    setTest(null);
    setTesting(true);
    try {
      let result: TestResult;
      if (saved && !dirty) {
        // Nothing changed: test the stored configuration, which also records the result.
        result = await api.testSavedProvider(saved.id);
        setSaved({
          ...saved,
          last_test: {
            status: result.status,
            message: result.message,
            latency_ms: result.latency_ms,
            at: result.tested_at,
          },
          last_success_at: result.ok ? result.tested_at : saved.last_success_at,
        });
        await refresh();
      } else {
        const body = validated();
        if (!body) return;
        result = await api.testProviderSettings(body, saved?.id);
      }
      setTest(result);
    } catch (e) {
      if (e instanceof ApiError && e.status === 422)
        showServerErrors(e, "Test failed");
      setTestError(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTesting(false);
    }
  };

  const loadModels = async () => {
    if (!saved) return;
    setLoadingModels(true);
    setModelsNote(null);
    try {
      const out = await api.providerModels(saved.id);
      setLoadedModels(out.models);
      setModelsNote(
        `Loaded ${out.models.length} models. Pick one from the model field's list.`,
      );
    } catch (e) {
      setModelsNote(
        e instanceof Error
          ? `Could not load models: ${e.message}`
          : "Could not load models.",
      );
    } finally {
      setLoadingModels(false);
    }
  };

  const remove = async () => {
    if (!saved) return;
    setDeleteError(null);
    try {
      await api.deleteProvider(saved.id);
      markClean();
      navigate({ page: "settings" });
      await refresh(saved.id);
    } catch (e) {
      setConfirming(false);
      const agents =
        e instanceof ApiError && e.status === 409
          ? (e.body as { agents?: { name: string; role: string }[] }).agents
          : undefined;
      if (agents && agents.length > 0) {
        setDeleteError(
          `This provider cannot be deleted because it is used by ${agents.map((a) => `${a.name} (${a.role})`).join(", ")}. Choose another provider for ${agents.length === 1 ? "that agent" : "those agents"} in Settings first.`,
        );
      } else setDeleteError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const presets = info?.models ?? [];
  const modelOptions = [
    ...new Set([...presets.map((m) => m.id), ...loadedModels]),
  ];
  const preset = presets.find((m) => m.id === form.model.trim());
  const contextWindow =
    Number(form.contextWindow) > 0
      ? Number(form.contextWindow)
      : preset?.context_window;
  const maxOutput =
    preset?.max_output ??
    (Number(form.maxTokens) > 0 ? Number(form.maxTokens) : null);
  const status = test?.status ?? saved?.last_test?.status ?? null;
  const params = info?.params ?? [];
  const has = (p: string) => params.includes(p);
  const temperatureValue = form.temperature === "" ? "1" : form.temperature;

  const err = (field: string) => errors[field];
  const describe = (field: string, hint = false) =>
    [
      hint ? `${id(field)}-hint` : null,
      err(field) ? `${id(field)}-error` : null,
    ]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <section
      className="settings-page provider-page"
      aria-label="Provider configuration"
    >
      <a className="back-link" href="#/settings">
        ← Back to providers
      </a>
      <header className="provider-page-header">
        <h1>{saved ? saved.name : "New provider"}</h1>
        <label className="switch">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => set("isActive", e.target.checked)}
          />
          Active
        </label>
      </header>
      {dirty && (
        <p className="muted unsaved" role="status">
          You have unsaved changes.
        </p>
      )}
      {formError && (
        <p className="error" role="alert">
          {formError}
        </p>
      )}

      <section className="provider-section" aria-label="Provider type">
        <h2>1. Provider type</h2>
        <div
          className="type-cards"
          role="radiogroup"
          aria-label="Provider type"
        >
          {types.map((t) => (
            <label
              key={t.type}
              className={`type-card${form.type === t.type ? " selected" : ""}`}
            >
              <input
                type="radio"
                name={id("type")}
                aria-label={t.label}
                checked={form.type === t.type}
                onChange={() => pickType(t)}
              />
              <span className="type-card-title">{t.label}</span>
              <span className="type-card-note">
                {t.type === "claude-code"
                  ? "Uses Claude Code on this machine"
                  : t.needs_key
                    ? "API key"
                    : "No key needed"}
              </span>
            </label>
          ))}
        </div>
        {err("provider_type") && (
          <span className="field-error" role="alert">
            {err("provider_type")}
          </span>
        )}
      </section>

      <section className="provider-section" aria-label="Connection and model">
        <h2>2. Connection and model</h2>
        <Field label="Name" htmlFor={id("name")} error={err("name")}>
          <input
            id={id("name")}
            value={form.name}
            aria-invalid={!!err("name")}
            aria-describedby={describe("name")}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>

        <Field
          label="Model"
          htmlFor={id("model_name")}
          error={err("model_name")}
        >
          <div className="inline-row">
            <input
              id={id("model_name")}
              list={id("models")}
              value={form.model}
              autoComplete="off"
              aria-invalid={!!err("model_name")}
              aria-describedby={describe("model_name")}
              onChange={(e) => set("model", e.target.value)}
            />
            {saved && (
              <button
                type="button"
                onClick={() => void loadModels()}
                disabled={loadingModels}
              >
                {loadingModels ? "Loading…" : "Load models"}
              </button>
            )}
          </div>
          <datalist id={id("models")}>
            {modelOptions.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          {modelsNote && (
            <span className="field-hint" role="status">
              {modelsNote}
            </span>
          )}
        </Field>

        <Field
          label={
            isClaudeCode
              ? "Setup token (optional)"
              : isAnthropic
                ? "API key or setup token"
                : "API key"
          }
          htmlFor={id("api_key")}
          error={err("api_key")}
          hint={keyHint}
        >
          <div className="inline-row">
            <input
              id={id("api_key")}
              type={showKey ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              value={form.apiKey}
              placeholder={
                saved?.key_hint
                  ? `Saved ${saved.key_kind === "setup_token" ? "setup token" : "key"} (${saved.key_hint}), type to replace`
                  : isClaudeCode
                    ? "Paste a claude setup-token"
                    : isAnthropic
                      ? "Paste an API key or a claude setup-token"
                      : "Paste your API key"
              }
              aria-invalid={!!err("api_key")}
              aria-describedby={describe("api_key", !!keyHint)}
              onChange={(e) => set("apiKey", e.target.value)}
            />
            <button
              type="button"
              aria-pressed={showKey}
              onClick={() => setShowKey(!showKey)}
            >
              {showKey ? "Hide" : "Show"}
            </button>
          </div>
        </Field>

        {!isClaudeCode && (
          <Field
            label="Base URL"
            htmlFor={id("base_url")}
            error={err("base_url")}
            hint={
              info && !info.needs_base_url
                ? "Optional. Leave the default unless you use a proxy."
                : undefined
            }
          >
            <input
              id={id("base_url")}
              inputMode="url"
              spellCheck={false}
              value={form.baseUrl}
              placeholder={info?.default_base_url ?? "https://…"}
              aria-invalid={!!err("base_url")}
              aria-describedby={describe(
                "base_url",
                !!info && !info.needs_base_url,
              )}
              onChange={(e) => set("baseUrl", e.target.value)}
            />
          </Field>
        )}

        {has("temperature") && (
          <Field
            label="Temperature"
            htmlFor={id("temperature")}
            error={err("temperature")}
          >
            <div className="inline-row">
              <input
                id={id("temperature")}
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={form.temperature}
                placeholder="Provider default"
                aria-invalid={!!err("temperature")}
                aria-describedby={describe("temperature")}
                onChange={(e) => set("temperature", e.target.value)}
              />
              <input
                type="range"
                aria-label="Temperature slider"
                min={0}
                max={2}
                step={0.1}
                value={temperatureValue}
                onChange={(e) => set("temperature", e.target.value)}
              />
            </div>
          </Field>
        )}

        <div className="field-grid">
          {has("max_tokens") && (
            <Field
              label="Max tokens"
              htmlFor={id("max_tokens")}
              error={err("max_tokens")}
            >
              <input
                id={id("max_tokens")}
                type="number"
                min={1}
                value={form.maxTokens}
                aria-invalid={!!err("max_tokens")}
                aria-describedby={describe("max_tokens")}
                onChange={(e) => set("maxTokens", e.target.value)}
              />
            </Field>
          )}
          {has("top_p") && (
            <Field label="Top p" htmlFor={id("top_p")} error={err("top_p")}>
              <input
                id={id("top_p")}
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={form.topP}
                aria-invalid={!!err("top_p")}
                aria-describedby={describe("top_p")}
                onChange={(e) => set("topP", e.target.value)}
              />
            </Field>
          )}
          {has("timeout") && (
            <Field
              label="Timeout (seconds)"
              htmlFor={id("timeout")}
              error={err("timeout")}
            >
              <input
                id={id("timeout")}
                type="number"
                min={1}
                max={600}
                value={form.timeout}
                aria-invalid={!!err("timeout")}
                aria-describedby={describe("timeout")}
                onChange={(e) => set("timeout", e.target.value)}
              />
            </Field>
          )}
        </div>
      </section>

      {!isClaudeCode && (
        <details
          className="provider-section"
          open={advancedOpen}
          onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}
        >
          <summary>Advanced parameters</summary>
          <div className="field-grid">
            {has("top_k") && (
              <Field label="Top k" htmlFor={id("top_k")} error={err("top_k")}>
                <input
                  id={id("top_k")}
                  type="number"
                  min={1}
                  value={form.topK}
                  onChange={(e) => set("topK", e.target.value)}
                />
              </Field>
            )}
            {has("frequency_penalty") && (
              <Field
                label="Frequency penalty"
                htmlFor={id("frequency_penalty")}
                error={err("frequency_penalty")}
              >
                <input
                  id={id("frequency_penalty")}
                  type="number"
                  step={0.1}
                  value={form.frequencyPenalty}
                  onChange={(e) => set("frequencyPenalty", e.target.value)}
                />
              </Field>
            )}
            {has("presence_penalty") && (
              <Field
                label="Presence penalty"
                htmlFor={id("presence_penalty")}
                error={err("presence_penalty")}
              >
                <input
                  id={id("presence_penalty")}
                  type="number"
                  step={0.1}
                  value={form.presencePenalty}
                  onChange={(e) => set("presencePenalty", e.target.value)}
                />
              </Field>
            )}
            {has("seed") && (
              <Field label="Seed" htmlFor={id("seed")} error={err("seed")}>
                <input
                  id={id("seed")}
                  type="number"
                  value={form.seed}
                  onChange={(e) => set("seed", e.target.value)}
                />
              </Field>
            )}
            {has("response_format") && (
              <Field
                label="Response format"
                htmlFor={id("response_format")}
                error={err("response_format")}
              >
                <select
                  id={id("response_format")}
                  value={form.responseFormat}
                  onChange={(e) =>
                    set(
                      "responseFormat",
                      e.target.value as FormState["responseFormat"],
                    )
                  }
                >
                  <option value="">Provider default</option>
                  <option value="text">Text</option>
                  <option value="json">JSON</option>
                </select>
              </Field>
            )}
            {has("context_window") && (
              <Field
                label="Context window (tokens)"
                htmlFor={id("context_window")}
                error={err("context_window")}
              >
                <input
                  id={id("context_window")}
                  type="number"
                  min={1}
                  value={form.contextWindow}
                  onChange={(e) => set("contextWindow", e.target.value)}
                />
              </Field>
            )}
          </div>
          {has("stop") && (
            <Field
              label="Stop sequences (one per line)"
              htmlFor={id("stop")}
              error={err("stop")}
            >
              <textarea
                id={id("stop")}
                rows={2}
                value={form.stop}
                onChange={(e) => set("stop", e.target.value)}
              />
            </Field>
          )}
          {!isClaudeCode && (
            <Field
              label="Provider-specific parameters (JSON)"
              htmlFor={id("extra")}
              error={err("extra")}
            >
              <textarea
                id={id("extra")}
                rows={4}
                spellCheck={false}
                placeholder='{"key": "value"}'
                value={form.extra}
                aria-invalid={!!err("extra")}
                aria-describedby={describe("extra")}
                onChange={(e) => set("extra", e.target.value)}
              />
            </Field>
          )}
        </details>
      )}

      <section className="provider-section" aria-label="Test connection">
        <h2>3. Test connection</h2>
        <div className="provider-actions">
          <button
            type="button"
            onClick={() => void runTest()}
            disabled={testing || busy}
          >
            {testing ? "Testing…" : "Test Connection"}
          </button>
          {saved && dirty && (
            <span className="muted small">
              Tests the settings above, saved or not.
            </span>
          )}
        </div>
        {test && (
          <div
            className={test.ok ? "test-result ok" : "test-result error"}
            role="status"
            data-status={test.status}
          >
            <strong>{STATUS_LABEL[test.status]}.</strong>{" "}
            {TEST_MESSAGE[test.status]}
            {test.latency_ms !== null && <> Latency: {test.latency_ms} ms.</>}
            {!test.ok && test.message && (
              <div className="small">Provider message: {test.message}</div>
            )}
          </div>
        )}
        {testError && (
          <p className="error" role="alert">
            {testError}
          </p>
        )}
      </section>

      <section className="provider-section" aria-label="Provider information">
        <h2>4. Provider information</h2>
        <dl className="info-grid">
          <dt>Name</dt>
          <dd>{form.name.trim() || "-"}</dd>
          <dt>Type</dt>
          <dd>{info?.label ?? form.type}</dd>
          <dt>Model</dt>
          <dd>{form.model.trim() || "-"}</dd>
          <dt>Context window</dt>
          <dd>
            {contextWindow
              ? `${contextWindow.toLocaleString("en-US")} tokens`
              : "Unknown"}
          </dd>
          <dt>Max output</dt>
          <dd>
            {maxOutput
              ? `${maxOutput.toLocaleString("en-US")} tokens`
              : "Unknown"}
          </dd>
          <dt>Capabilities</dt>
          <dd>{info?.capabilities.join(", ") || "-"}</dd>
          <dt>Status</dt>
          <dd>{status ? STATUS_LABEL[status] : "Unknown"}</dd>
          <dt>Last successful test</dt>
          <dd>
            {saved?.last_success_at
              ? formatTime(saved.last_success_at)
              : "Not tested yet"}
          </dd>
        </dl>
      </section>

      <div className="provider-actions provider-footer">
        <button
          type="button"
          className="primary"
          onClick={() => void save()}
          disabled={busy}
        >
          Save Changes
        </button>
        {justSaved && (
          <span className="muted" role="status">
            Saved.
          </span>
        )}
        {saved &&
          (confirming ? (
            <span
              className="confirm"
              role="alertdialog"
              aria-label="Confirm delete"
            >
              Delete this provider and its key?
              <button
                type="button"
                className="danger"
                onClick={() => void remove()}
              >
                Yes, delete
              </button>
              <button type="button" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="danger"
              onClick={() => {
                setDeleteError(null);
                setConfirming(true);
              }}
            >
              Delete
            </button>
          ))}
      </div>
      {deleteError && (
        <p className="error" role="alert">
          {deleteError}
        </p>
      )}
    </section>
  );
}
