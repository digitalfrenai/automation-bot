"use client";

import Link from "next/link";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  FilePenLine,
  GitBranch,
  Loader2,
  Newspaper,
  RefreshCw,
  Rocket,
  Save,
  Share2,
  Trash2,
  Upload,
  Wifi,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ManagementPanel } from "@/components/management-panel";
import {
  parsePipelineSsePayload,
  TerminalLogger,
  type LogMessage,
  type TerminalPipelineStatus,
} from "@/components/TerminalLogger";
import { uploadPreviewUrl } from "@/lib/upload-preview-url";
import {
  DEFAULT_PAGES,
  SINGLE_CONFIG_ID,
  STANDARD_PAGE_OPTIONS,
} from "@/lib/site-config";

type TabId =
  | "credentials"
  | "hosting"
  | "business"
  | "pages"
  | "blog"
  | "maintenance"
  | "social"
  | "e2e"
  | "manage";

type ConnectionStatus = {
  grok: { ok: boolean; error: string | null };
  wordpress: { ok: boolean; error: string | null };
  allOk: boolean;
} | null;

type FormState = {
  xaiApiKey: string;
  wpUrl: string;
  wpUsername: string;
  wpAppPassword: string;
  sftpHost: string;
  sftpPort: string;
  sftpUsername: string;
  sftpPassword: string;
  businessName: string;
  businessLogoUrl: string;
  businessLogoFilePath: string;
  designReferencePaths: string[];
  niche: string;
  targetAudience: string;
  toneOfVoice: string;
  coreServices: string[];
  targetKeywords: string[];
  pagesToBuild: string[];
  activeThemeZipPath: string;
  blogPostsPerRun: number;
  blogRequireApproval: boolean;
  blogIncludeExternalLinks: boolean;
  blogCategory: string;
  blogReferencePostUrl: string;
  blogRunContentTopic: string;
  blogRunKeywords: string;
  blogRunImagePaths: string[];
  blogImagesDriveFolderUrl: string;
  pageImageUploadPaths: string[];
  pageImagesDriveFolderUrl: string;
  updateMaxAgeDays: number;
  updateRequireApproval: boolean;
  updateRefreshPages: boolean;
  updateRefreshPosts: boolean;
  updateMaxItemsPerRun: number;
  socialEnabled: boolean;
  socialAutoGenerateOnBlog: boolean;
  socialAutoGenerateOnUpdate: boolean;
  socialRequireApproval: boolean;
  socialPlatforms: string[];
  socialScheduleDelayHours: number;
  socialXAccessToken: string;
  socialLinkedInAccessToken: string;
  socialLinkedInAuthorUrn: string;
  socialFacebookPageToken: string;
  socialFacebookPageId: string;
  socialInstagramAccountId: string;
  e2eIncludeBlog: boolean;
  e2eIncludeContentUpdate: boolean;
  e2eIncludeSocial: boolean;
};

type JobHistory = {
  blogPosts: Array<{
    id: string;
    topic: string;
    title: string | null;
    status: string;
    wpPostId: number | null;
    createdAt: string;
  }>;
  contentUpdates: Array<{
    id: string;
    contentType: string;
    title: string;
    status: string;
    reason: string;
    createdAt: string;
  }>;
  socialPosts?: Array<{
    id: string;
    platform: string;
    status: string;
    sourceTitle: string | null;
    createdAt: string;
  }>;
};

const initialForm: FormState = {
  xaiApiKey: "",
  wpUrl: "",
  wpUsername: "",
  wpAppPassword: "",
  sftpHost: "",
  sftpPort: "22",
  sftpUsername: "",
  sftpPassword: "",
  businessName: "",
  businessLogoUrl: "",
  businessLogoFilePath: "",
  designReferencePaths: [],
  niche: "",
  targetAudience: "",
  toneOfVoice: "",
  coreServices: [],
  targetKeywords: [],
  pagesToBuild: [...DEFAULT_PAGES],
  activeThemeZipPath: "",
  blogPostsPerRun: 1,
  blogRequireApproval: true,
  blogIncludeExternalLinks: true,
  blogCategory: "",
  blogReferencePostUrl: "",
  blogRunContentTopic: "",
  blogRunKeywords: "",
  blogRunImagePaths: [],
  blogImagesDriveFolderUrl: "",
  pageImageUploadPaths: [],
  pageImagesDriveFolderUrl: "",
  updateMaxAgeDays: 90,
  updateRequireApproval: true,
  updateRefreshPages: true,
  updateRefreshPosts: true,
  updateMaxItemsPerRun: 5,
  socialEnabled: false,
  socialAutoGenerateOnBlog: true,
  socialAutoGenerateOnUpdate: false,
  socialRequireApproval: true,
  socialPlatforms: ["x", "linkedin", "facebook", "instagram"],
  socialScheduleDelayHours: 1,
  socialXAccessToken: "",
  socialLinkedInAccessToken: "",
  socialLinkedInAuthorUrn: "",
  socialFacebookPageToken: "",
  socialFacebookPageId: "",
  socialInstagramAccountId: "",
  e2eIncludeBlog: true,
  e2eIncludeContentUpdate: false,
  e2eIncludeSocial: true,
};

const tabs: { id: TabId; label: string }[] = [
  { id: "credentials", label: "Credentials" },
  { id: "hosting", label: "Hosting & Theme" },
  { id: "business", label: "Business Brief" },
  { id: "pages", label: "Page Structure" },
  { id: "blog", label: "Blog (Phase 4)" },
  { id: "maintenance", label: "Updates (Phase 5)" },
  { id: "social", label: "Social (Phase 6)" },
  { id: "e2e", label: "E2E (Phase 7)" },
  { id: "manage", label: "Manage (Phase 8)" },
];

const SOCIAL_PLATFORM_OPTIONS = ["x", "linkedin", "facebook", "instagram"] as const;

function parseCommaInput(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function TagInput({
  label,
  hint,
  tags,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  const addTags = (raw: string) => {
    const next = parseCommaInput(raw);
    if (next.length === 0) return;
    onChange([...new Set([...tags, ...next])]);
    setDraft("");
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-slate-700">{label}</label>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
      <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-white p-2 min-h-[42px]">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700"
          >
            {tag}
            <button
              type="button"
              className="text-slate-400 hover:text-slate-600"
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              aria-label={`Remove ${tag}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className="min-w-[120px] flex-1 border-0 bg-transparent px-1 py-1 text-sm outline-none"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addTags(draft);
            }
          }}
          onBlur={() => addTags(draft)}
          placeholder={placeholder ?? "Type and press Enter"}
        />
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-slate-700">{label}</label>
      {children}
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";

export function SettingsDashboard() {
  const [activeTab, setActiveTab] = useState<TabId>("credentials");
  const [form, setForm] = useState<FormState>(initialForm);
  const [customPage, setCustomPage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [removingLogo, setRemovingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const designRefAddInputRef = useRef<HTMLInputElement>(null);
  const designRefReplaceInputRef = useRef<HTMLInputElement>(null);
  const [designRefUploadMode, setDesignRefUploadMode] = useState<
    "add" | "replace" | null
  >(null);
  const [clearingDesignRef, setClearingDesignRef] = useState(false);
  const designRefBusy = designRefUploadMode !== null || clearingDesignRef;
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>(null);
  const [connectionsVerified, setConnectionsVerified] = useState(false);
  const [banner, setBanner] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);
  const [isPipelineRunning, setIsPipelineRunning] = useState(false);
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [pipelineStatus, setPipelineStatus] =
    useState<TerminalPipelineStatus>("IDLE");
  const [jobHistory, setJobHistory] = useState<JobHistory | null>(null);

  const patch = useCallback((partial: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...partial }));
    setConnectionsVerified(false);
    setConnectionStatus(null);
  }, []);

  const loadJobHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs");
      if (!res.ok) return;
      const data = (await res.json()) as JobHistory;
      setJobHistory(data);
    } catch {
      /* optional history */
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/config");
        const data = await res.json();
        if (data.config) {
          setForm({
            xaiApiKey: data.config.xaiApiKey ?? "",
            wpUrl: data.config.wpUrl ?? "",
            wpUsername: data.config.wpUsername ?? "",
            wpAppPassword: data.config.wpAppPassword ?? "",
            sftpHost: data.config.sftpHost ?? "",
            sftpPort: data.config.sftpPort ?? "22",
            sftpUsername: data.config.sftpUsername ?? "",
            sftpPassword: data.config.sftpPassword ?? "",
            businessName: data.config.businessName ?? "",
            businessLogoUrl: data.config.businessLogoUrl ?? "",
            businessLogoFilePath: data.config.businessLogoFilePath ?? "",
            designReferencePaths: data.config.designReferencePaths ?? [],
            niche: data.config.niche ?? "",
            targetAudience: data.config.targetAudience ?? "",
            toneOfVoice: data.config.toneOfVoice ?? "",
            coreServices: data.config.coreServices ?? [],
            targetKeywords: data.config.targetKeywords ?? [],
            pagesToBuild: data.config.pagesToBuild?.length
              ? data.config.pagesToBuild
              : [...DEFAULT_PAGES],
            activeThemeZipPath: data.config.activeThemeZipPath ?? "",
            blogPostsPerRun: data.config.blogPostsPerRun ?? 1,
            blogRequireApproval: data.config.blogRequireApproval !== false,
            blogIncludeExternalLinks:
              data.config.blogIncludeExternalLinks !== false,
            blogCategory:
              typeof data.config.blogCategory === "string"
                ? data.config.blogCategory
                : "",
            blogReferencePostUrl: data.config.blogReferencePostUrl ?? "",
            blogRunContentTopic: data.config.blogRunContentTopic ?? "",
            blogRunKeywords: Array.isArray(data.config.blogRunKeywords)
              ? data.config.blogRunKeywords.join(", ")
              : "",
            blogRunImagePaths: data.config.blogRunImagePaths ?? [],
            blogImagesDriveFolderUrl: data.config.blogImagesDriveFolderUrl ?? "",
            pageImageUploadPaths: data.config.pageImageUploadPaths ?? [],
            pageImagesDriveFolderUrl: data.config.pageImagesDriveFolderUrl ?? "",
            updateMaxAgeDays: data.config.updateMaxAgeDays ?? 90,
            updateRequireApproval: data.config.updateRequireApproval !== false,
            updateRefreshPages: data.config.updateRefreshPages !== false,
            updateRefreshPosts: data.config.updateRefreshPosts !== false,
            updateMaxItemsPerRun: data.config.updateMaxItemsPerRun ?? 5,
            socialEnabled: data.config.socialEnabled === true,
            socialAutoGenerateOnBlog:
              data.config.socialAutoGenerateOnBlog !== false,
            socialAutoGenerateOnUpdate:
              data.config.socialAutoGenerateOnUpdate === true,
            socialRequireApproval: data.config.socialRequireApproval !== false,
            socialPlatforms: data.config.socialPlatforms?.length
              ? data.config.socialPlatforms
              : ["x", "linkedin", "facebook", "instagram"],
            socialScheduleDelayHours:
              data.config.socialScheduleDelayHours ?? 1,
            socialXAccessToken: data.config.socialXAccessToken ?? "",
            socialLinkedInAccessToken:
              data.config.socialLinkedInAccessToken ?? "",
            socialLinkedInAuthorUrn: data.config.socialLinkedInAuthorUrn ?? "",
            socialFacebookPageToken: data.config.socialFacebookPageToken ?? "",
            socialFacebookPageId: data.config.socialFacebookPageId ?? "",
            socialInstagramAccountId:
              data.config.socialInstagramAccountId ?? "",
            e2eIncludeBlog: data.config.e2eIncludeBlog !== false,
            e2eIncludeContentUpdate:
              data.config.e2eIncludeContentUpdate === true,
            e2eIncludeSocial: data.config.e2eIncludeSocial !== false,
          });
        }
        if (
          data.storage &&
          data.storage.persistentStorageOk === false &&
          data.storage.warning
        ) {
          setBanner({ type: "error", message: data.storage.warning });
        }
        await loadJobHistory();
      } catch {
        setBanner({ type: "error", message: "Could not load saved configuration." });
      } finally {
        setLoading(false);
      }
    })();
  }, [loadJobHistory]);

  const togglePage = (page: string) => {
    patch({
      pagesToBuild: form.pagesToBuild.includes(page)
        ? form.pagesToBuild.filter((p) => p !== page)
        : [...form.pagesToBuild, page],
    });
  };

  const addCustomPage = () => {
    const name = customPage.trim();
    if (!name) return;
    if (!form.pagesToBuild.includes(name)) {
      patch({ pagesToBuild: [...form.pagesToBuild, name] });
    }
    setCustomPage("");
  };

  const customPages = useMemo(
    () =>
      form.pagesToBuild.filter(
        (p) => !(STANDARD_PAGE_OPTIONS as readonly string[]).includes(p)
      ),
    [form.pagesToBuild]
  );

  const testConnections = async () => {
    setTesting(true);
    setBanner(null);
    try {
      const res = await fetch("/api/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          xaiApiKey: form.xaiApiKey,
          wpUrl: form.wpUrl,
          wpUsername: form.wpUsername,
          wpAppPassword: form.wpAppPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ type: "error", message: data.error ?? "Connection test failed." });
        setConnectionsVerified(false);
        return;
      }
      setConnectionStatus(data);
      setConnectionsVerified(data.allOk);
      setBanner({
        type: data.allOk ? "success" : "error",
        message: data.allOk
          ? "All connection tests passed."
          : "One or more connection tests failed. Review details below.",
      });
    } catch {
      setBanner({ type: "error", message: "Connection test request failed." });
      setConnectionsVerified(false);
    } finally {
      setTesting(false);
    }
  };

  const saveConfiguration = async () => {
    setSaving(true);
    setBanner(null);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ type: "error", message: data.error ?? "Save failed." });
        return;
      }
      setBanner({ type: "success", message: "Configuration saved successfully." });
    } catch {
      setBanner({ type: "error", message: "Could not save configuration." });
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (file: File | null) => {
    if (!file) return;
    setUploadingLogo(true);
    setBanner(null);
    try {
      const body = new FormData();
      body.append("logo", file);
      const res = await fetch("/api/upload-logo", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ type: "error", message: data.error ?? "Logo upload failed." });
        return;
      }
      patch({ businessLogoFilePath: data.path, businessLogoUrl: "" });
      setBanner({ type: "success", message: `Logo uploaded: ${data.filename}` });
    } catch {
      setBanner({ type: "error", message: "Logo upload failed." });
    } finally {
      setUploadingLogo(false);
    }
  };

  const removeLogo = async () => {
    setRemovingLogo(true);
    setBanner(null);
    try {
      const res = await fetch("/api/upload-logo", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ type: "error", message: data.error ?? "Could not remove logo." });
        return;
      }
      patch({ businessLogoFilePath: "", businessLogoUrl: "" });
      if (logoInputRef.current) logoInputRef.current.value = "";
      setBanner({ type: "success", message: "Logo removed." });
    } catch {
      setBanner({ type: "error", message: "Could not remove logo." });
    } finally {
      setRemovingLogo(false);
    }
  };

  const uploadDesignReferences = async (
    files: FileList | null,
    mode: "add" | "replace"
  ) => {
    if (!files?.length) return;
    setDesignRefUploadMode(mode);
    setBanner(null);
    try {
      const body = new FormData();
      Array.from(files).forEach((f) => body.append("screenshots", f));
      if (mode === "replace") body.append("replace", "true");
      const res = await fetch("/api/upload-design-reference", {
        method: "POST",
        body,
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner({
          type: "error",
          message: data.error ?? "Screenshot upload failed.",
        });
        return;
      }
      patch({ designReferencePaths: data.paths ?? [] });
      setBanner({
        type: "success",
        message:
          mode === "replace"
            ? `Replaced reference set with ${data.added ?? 0} screenshot(s). Phase 2 will match this design.`
            : `Added ${data.added ?? 0} reference screenshot(s). Phase 2 will match this design.`,
      });
      if (mode === "replace" && designRefReplaceInputRef.current) {
        designRefReplaceInputRef.current.value = "";
      }
      if (mode === "add" && designRefAddInputRef.current) {
        designRefAddInputRef.current.value = "";
      }
    } catch {
      setBanner({ type: "error", message: "Screenshot upload failed." });
    } finally {
      setDesignRefUploadMode(null);
    }
  };

  const clearDesignReferences = async () => {
    setClearingDesignRef(true);
    setBanner(null);
    try {
      const res = await fetch("/api/upload-design-reference", {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner({
          type: "error",
          message: data.error ?? "Could not clear reference screenshots.",
        });
        return;
      }
      patch({ designReferencePaths: [] });
      if (designRefAddInputRef.current) designRefAddInputRef.current.value = "";
      if (designRefReplaceInputRef.current) {
        designRefReplaceInputRef.current.value = "";
      }
      setBanner({
        type: "success",
        message: "All reference screenshots removed.",
      });
    } catch {
      setBanner({
        type: "error",
        message: "Could not clear reference screenshots.",
      });
    } finally {
      setClearingDesignRef(false);
    }
  };

  const uploadPageImages = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const body = new FormData();
    for (const file of Array.from(fileList)) {
      body.append("images", file);
    }
    try {
      const res = await fetch("/api/upload-page-image", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ type: "error", message: data.error ?? "Page image upload failed." });
        return;
      }
      patch({ pageImageUploadPaths: data.paths ?? [] });
      setBanner({
        type: "success",
        message: `Saved ${data.added ?? 0} page image(s). Save configuration to keep Drive URL.`,
      });
    } catch {
      setBanner({ type: "error", message: "Page image upload failed." });
    }
  };

  const importDriveImages = async (target: "page" | "blog") => {
    const folderUrl =
      target === "blog"
        ? form.blogImagesDriveFolderUrl.trim()
        : form.pageImagesDriveFolderUrl.trim();
    if (!folderUrl) {
      setBanner({ type: "error", message: "Paste a Google Drive folder link first." });
      return;
    }
    try {
      const res = await fetch("/api/import-drive-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderUrl, target, replace: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ type: "error", message: data.error ?? "Drive import failed." });
        return;
      }
      if (target === "blog") {
        patch({ blogRunImagePaths: data.paths ?? [] });
      } else {
        patch({ pageImageUploadPaths: data.paths ?? [] });
      }
      setBanner({
        type: "success",
        message: `Imported ${data.downloaded ?? 0} image(s) from Google Drive.`,
      });
    } catch {
      setBanner({ type: "error", message: "Drive import failed." });
    }
  };

  const uploadBlogImages = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const body = new FormData();
    for (const file of Array.from(fileList)) {
      body.append("images", file);
    }
    try {
      const res = await fetch("/api/upload-blog-image", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ type: "error", message: data.error ?? "Blog image upload failed." });
        return;
      }
      patch({ blogRunImagePaths: data.paths ?? [] });
      setBanner({
        type: "success",
        message: `Blog images: ${(data.paths ?? []).length}/3 uploaded.`,
      });
    } catch {
      setBanner({ type: "error", message: "Blog image upload failed." });
    }
  };

  const uploadTheme = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    setBanner(null);
    try {
      const body = new FormData();
      body.append("theme", file);
      const res = await fetch("/api/upload-theme", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ type: "error", message: data.error ?? "Upload failed." });
        return;
      }
      patch({ activeThemeZipPath: data.path });
      setBanner({ type: "success", message: `Theme uploaded: ${data.filename}` });
    } catch {
      setBanner({ type: "error", message: "Theme upload failed." });
    } finally {
      setUploading(false);
    }
  };

  const appendLog = useCallback((entry: LogMessage) => {
    setLogs((prev) => [...prev, entry]);
  }, []);

  const streamPipeline = async (
    endpoint: string,
    body: Record<string, unknown>,
    successMessage: string,
    options?: { appendLogs?: boolean; manageRunningState?: boolean }
  ): Promise<boolean> => {
    const manageRunning = options?.manageRunningState !== false;
    if (manageRunning) {
      setIsPipelineRunning(true);
      setPipelineStatus("RUNNING");
    }
    if (!options?.appendLogs) {
      setLogs([]);
    }
    if (manageRunning) {
      setBanner({
        type: "info",
        message: "Pipeline started. Streaming logs below…",
      });
    }

    let failed = false;
    let completed = false;

    try {
      const saveRes = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!saveRes.ok) {
        const saveData = await saveRes.json();
        const message = saveData.error ?? "Save configuration before launching.";
        setPipelineStatus("FAILED");
        appendLog({
          timestamp: new Date().toISOString(),
          level: "error",
          message,
        });
        setBanner({ type: "error", message });
        failed = true;
        return false;
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok || !res.body) {
        const message = "Pipeline request failed.";
        setPipelineStatus("FAILED");
        appendLog({
          timestamp: new Date().toISOString(),
          level: "error",
          message,
        });
        setBanner({ type: "error", message });
        failed = true;
        return false;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;

          const parsed = parsePipelineSsePayload(payload);
          if (!parsed) continue;

          if (parsed.kind === "log") {
            setLogs((prev) => [...prev, parsed.entry]);
            continue;
          }

          if (parsed.kind === "done") {
            completed = true;
            setPipelineStatus("COMPLETED");
            appendLog({
              timestamp: new Date().toISOString(),
              level: "info",
              phase: "complete",
              message: "Pipeline finished — status COMPLETED.",
            });
            if (successMessage.trim()) {
              setBanner({
                type: "success",
                message: successMessage,
              });
            }
            continue;
          }

          if (parsed.kind === "error") {
            failed = true;
            setPipelineStatus("FAILED");
            setLogs((prev) => {
              const last = prev[prev.length - 1];
              if (last?.level === "error" && last.message === parsed.message) {
                return prev;
              }
              return [
                ...prev,
                {
                  timestamp: new Date().toISOString(),
                  level: "error",
                  message: parsed.message,
                },
              ];
            });
            setBanner({ type: "error", message: parsed.message });
          }
        }
      }

      if (!completed && !failed) {
        setPipelineStatus("FAILED");
        appendLog({
          timestamp: new Date().toISOString(),
          level: "error",
          message: "Pipeline stream ended unexpectedly.",
        });
        failed = true;
      }
    } catch {
      setPipelineStatus("FAILED");
      appendLog({
        timestamp: new Date().toISOString(),
        level: "error",
        message: "Pipeline stream disconnected.",
      });
      setBanner({ type: "error", message: "Pipeline stream disconnected." });
      failed = true;
    } finally {
      if (manageRunning) {
        setIsPipelineRunning(false);
        await loadJobHistory();
      }
    }

    return completed && !failed;
  };

  const runPhaseForEachPage = async (
    endpoint: string,
    phaseLabel: string,
    successMessage: string
  ) => {
    const pages =
      form.pagesToBuild.length > 0 ? form.pagesToBuild : [...DEFAULT_PAGES];

    setIsPipelineRunning(true);
    setPipelineStatus("RUNNING");
    setLogs([]);
    setBanner({
      type: "info",
      message: `${phaseLabel} — ${pages.length} page(s), one Railway request each (15 min max per page).`,
    });

    try {
      for (let i = 0; i < pages.length; i++) {
        const pageTitle = pages[i]!;
        appendLog({
          timestamp: new Date().toISOString(),
          level: "info",
          phase: "setup",
          message: `——— ${phaseLabel}: ${pageTitle} (${i + 1}/${pages.length}) ———`,
          pageTitle,
        });

        const ok = await streamPipeline(
          endpoint,
          { configId: SINGLE_CONFIG_ID, pageTitle },
          i === pages.length - 1 ? successMessage : "",
          { appendLogs: true, manageRunningState: false }
        );

        if (!ok) {
          setBanner({
            type: "error",
            message: `${phaseLabel} stopped at "${pageTitle}". Finished pages are saved — re-run to continue.`,
          });
          setPipelineStatus("FAILED");
          return;
        }
      }

      setPipelineStatus("COMPLETED");
    } finally {
      setIsPipelineRunning(false);
      await loadJobHistory();
    }
  };

  const launchAutomation = async () => {
    const pages =
      form.pagesToBuild.length > 0 ? form.pagesToBuild : [...DEFAULT_PAGES];

    setIsPipelineRunning(true);
    setPipelineStatus("RUNNING");
    setLogs([]);
    setBanner({
      type: "info",
      message:
        "Phases 1–3 — Phase 1 once, then one Railway request per page (avoids 15-minute timeout).",
    });

    try {
      const phase1Ok = await streamPipeline(
        "/api/run-phase1",
        { configId: SINGLE_CONFIG_ID },
        "",
        { manageRunningState: false }
      );
      if (!phase1Ok) {
        setBanner({ type: "error", message: "Phase 1 failed — fix logs and retry." });
        setPipelineStatus("FAILED");
        return;
      }

      for (let i = 0; i < pages.length; i++) {
        const pageTitle = pages[i]!;
        appendLog({
          timestamp: new Date().toISOString(),
          level: "info",
          phase: "setup",
          message: `——— Phases 2–3: ${pageTitle} (${i + 1}/${pages.length}) ———`,
          pageTitle,
        });

        const p2 = await streamPipeline(
          "/api/run-phase2",
          { configId: SINGLE_CONFIG_ID, pageTitle },
          "",
          { appendLogs: true, manageRunningState: false }
        );
        if (!p2) {
          setBanner({
            type: "error",
            message: `Stopped at Phase 2 for "${pageTitle}". Finished pages are saved.`,
          });
          setPipelineStatus("FAILED");
          return;
        }

        const p3 = await streamPipeline(
          "/api/run-phase3",
          { configId: SINGLE_CONFIG_ID, pageTitle },
          i === pages.length - 1 ? "" : "",
          { appendLogs: true, manageRunningState: false }
        );
        if (!p3) {
          setBanner({
            type: "error",
            message: `Stopped at Phase 3 for "${pageTitle}". Re-run Phase 3 for remaining pages.`,
          });
          setPipelineStatus("FAILED");
          return;
        }
      }

      setPipelineStatus("COMPLETED");
      setBanner({
        type: "success",
        message: "Phases 1–3 completed successfully.",
      });
    } finally {
      setIsPipelineRunning(false);
      await loadJobHistory();
    }
  };

  const resetHosting = async () => {
    if (
      !window.confirm(
        "Remove SFTP credentials and the uploaded theme zip from this dashboard?"
      )
    ) {
      return;
    }
    const res = await fetch("/api/reset-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "hosting" }),
    });
    const data = await res.json();
    if (!res.ok) {
      setBanner({ type: "error", message: data.error ?? "Could not clear hosting." });
      return;
    }
    patch({
      sftpHost: "",
      sftpPort: "22",
      sftpUsername: "",
      sftpPassword: "",
      activeThemeZipPath: "",
    });
    setBanner({ type: "success", message: data.message });
  };

  const resetAll = async () => {
    if (
      !window.confirm(
        "Reset brief, uploads, scaffold map, and job history? Credentials (xAI + WordPress) stay — change WP URL if switching sites."
      )
    ) {
      return;
    }
    const res = await fetch("/api/reset-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "all" }),
    });
    const data = await res.json();
    if (!res.ok) {
      setBanner({ type: "error", message: data.error ?? "Reset failed." });
      return;
    }
    setForm({ ...initialForm, xaiApiKey: form.xaiApiKey, wpUrl: form.wpUrl, wpUsername: form.wpUsername, wpAppPassword: form.wpAppPassword });
    setLogs([]);
    setPipelineStatus("IDLE");
    setBanner({ type: "success", message: data.message });
    await loadJobHistory();
  };

  const launchPhase1 = async () => {
    await streamPipeline(
      "/api/run-phase1",
      { configId: SINGLE_CONFIG_ID },
      "Phase 1 site setup completed."
    );
  };

  const launchPhase2 = async () => {
    await runPhaseForEachPage(
      "/api/run-phase2",
      "Phase 2",
      "Phase 2 content generation completed."
    );
  };

  const launchPhase3 = async () => {
    await runPhaseForEachPage(
      "/api/run-phase3",
      "Phase 3",
      "Phase 3 SEO publish completed."
    );
  };

  const launchBlogPipeline = async () => {
    await streamPipeline(
      "/api/run-blog",
      {
        configId: SINGLE_CONFIG_ID,
        topicCount: form.blogPostsPerRun,
        blogCategory: form.blogCategory.trim() || undefined,
      },
      "Phase 4 blog generation completed."
    );
  };

  const launchContentUpdate = async () => {
    await streamPipeline(
      "/api/run-content-update",
      { configId: SINGLE_CONFIG_ID },
      "Phase 5 content update completed."
    );
  };

  const launchSocial = async (mode: "generate" | "flush" = "generate") => {
    await streamPipeline(
      "/api/run-social",
      { configId: SINGLE_CONFIG_ID, mode },
      mode === "flush"
        ? "Scheduled social posts flushed."
        : "Phase 6 social generation completed."
    );
  };

  const launchE2E = async () => {
    await streamPipeline(
      "/api/run-e2e",
      {
        configId: SINGLE_CONFIG_ID,
        includeSiteSetup: true,
        includeBlog: form.e2eIncludeBlog,
        includeContentUpdate: form.e2eIncludeContentUpdate,
        includeSocial: form.e2eIncludeSocial && form.socialEnabled,
        topicCount: form.blogPostsPerRun,
      },
      "Phase 7 end-to-end workflow completed."
    );
  };

  const toggleSocialPlatform = (platform: string) => {
    patch({
      socialPlatforms: form.socialPlatforms.includes(platform)
        ? form.socialPlatforms.filter((p) => p !== platform)
        : [...form.socialPlatforms, platform],
    });
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-primary">
            Grok WordPress Automation
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">
            Setup Dashboard
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Configure credentials and business brief, then run Phases 1–5 alone, or
            enable social + E2E for the full connected pipeline with approvals.
          </p>
        </div>
        <Link
          href="/how-to-use"
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <BookOpen className="h-4 w-4" />
          How to use
        </Link>
      </header>

      {banner ? (
        <div
          className={`mb-6 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${
            banner.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : banner.type === "error"
                ? "border-red-200 bg-red-50 text-red-900"
                : "border-blue-200 bg-blue-50 text-blue-900"
          }`}
        >
          {banner.type === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{banner.message}</span>
        </div>
      ) : null}

      <nav className="mb-6 flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              activeTab === tab.id
                ? "bg-primary text-white shadow-sm"
                : "bg-white text-slate-600 ring-1 ring-border hover:bg-slate-50"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        {activeTab === "credentials" && (
          <section className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Credentials</h2>
              <p className="text-sm text-muted">
                xAI (Grok) and WordPress REST API application password access.
              </p>
            </div>
            <Field label="xAI API Key">
              <input
                type="password"
                className={inputClass}
                value={form.xaiApiKey}
                onChange={(e) => patch({ xaiApiKey: e.target.value })}
                placeholder="xai-..."
                autoComplete="off"
              />
            </Field>
            <Field label="WordPress Site URL">
              <input
                type="url"
                className={inputClass}
                value={form.wpUrl}
                onChange={(e) => patch({ wpUrl: e.target.value })}
                placeholder="https://example.com"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="WP Username">
                <input
                  className={inputClass}
                  value={form.wpUsername}
                  onChange={(e) => patch({ wpUsername: e.target.value })}
                />
              </Field>
              <Field label="WP Application Password">
                <input
                  type="password"
                  className={inputClass}
                  value={form.wpAppPassword}
                  onChange={(e) => patch({ wpAppPassword: e.target.value })}
                  autoComplete="off"
                />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={testConnections}
                disabled={testing}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {testing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wifi className="h-4 w-4" />
                )}
                Test Connection
              </button>
              {connectionStatus ? (
                <div className="flex flex-col gap-1 text-sm">
                  <span
                    className={
                      connectionStatus.grok.ok ? "text-success" : "text-danger"
                    }
                  >
                    {connectionStatus.grok.ok ? "✓" : "✗"} Grok:{" "}
                    {connectionStatus.grok.ok
                      ? "Connected"
                      : connectionStatus.grok.error}
                  </span>
                  <span
                    className={
                      connectionStatus.wordpress.ok ? "text-success" : "text-danger"
                    }
                  >
                    {connectionStatus.wordpress.ok ? "✓" : "✗"} WordPress:{" "}
                    {connectionStatus.wordpress.ok
                      ? "Connected"
                      : connectionStatus.wordpress.error}
                  </span>
                </div>
              ) : null}
            </div>
          </section>
        )}

        {activeTab === "hosting" && (
          <section className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Hosting & Theme
              </h2>
              <p className="text-sm text-muted">
                Optional SFTP credentials for theme deployment. Theme zip is optional if
                you use reference screenshots on the Business Brief tab — Phase 2 will
                build page design from those screenshots instead.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="SFTP Host">
                <input
                  className={inputClass}
                  value={form.sftpHost}
                  onChange={(e) => patch({ sftpHost: e.target.value })}
                />
              </Field>
              <Field label="SFTP Port">
                <input
                  className={inputClass}
                  value={form.sftpPort}
                  onChange={(e) => patch({ sftpPort: e.target.value })}
                />
              </Field>
              <Field label="SFTP Username">
                <input
                  className={inputClass}
                  value={form.sftpUsername}
                  onChange={(e) => patch({ sftpUsername: e.target.value })}
                />
              </Field>
              <Field label="SFTP Password">
                <input
                  type="password"
                  className={inputClass}
                  value={form.sftpPassword}
                  onChange={(e) => patch({ sftpPassword: e.target.value })}
                  autoComplete="off"
                />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={resetHosting}
                className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-900 hover:bg-red-100"
              >
                <Trash2 className="h-4 w-4" />
                Remove SFTP &amp; theme zip
              </button>
            </div>
            {form.activeThemeZipPath && !form.sftpHost.trim() ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                No SFTP — Phase 1 will try installing the zip via the{" "}
                <strong>WordPress Bot REST bridge</strong> (mu-plugin) when your app
                password can <code className="text-xs">install_themes</code>. Otherwise
                upload the theme in wp-admin or add SFTP.
              </p>
            ) : null}
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">
                Theme (.zip){" "}
                <span className="font-normal text-muted">— optional with screenshots</span>
              </p>
              <p className="mb-2 text-xs text-muted">
                Skip this if you uploaded reference screenshots; Grok will match the
                screenshot design using HTML in the page body. Your live WordPress theme
                still controls the site header and footer.
              </p>
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-slate-50 px-6 py-10 text-center transition hover:border-primary/50 hover:bg-slate-100">
                <Upload className="mb-2 h-8 w-8 text-muted" />
                <span className="text-sm font-medium text-slate-700">
                  {uploading ? "Uploading…" : "Drop theme zip or click to browse"}
                </span>
                <span className="mt-1 text-xs text-muted">Max 50MB, .zip only</span>
                <input
                  type="file"
                  accept=".zip,application/zip"
                  className="sr-only"
                  disabled={uploading}
                  onChange={(e) => uploadTheme(e.target.files?.[0] ?? null)}
                />
              </label>
              {form.activeThemeZipPath ? (
                <p className="mt-2 text-xs text-muted">
                  Active theme:{" "}
                  <code className="rounded bg-slate-100 px-1 py-0.5">
                    {form.activeThemeZipPath}
                  </code>
                </p>
              ) : null}
            </div>
          </section>
        )}

        {activeTab === "business" && (
          <section className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Business Brief</h2>
              <p className="text-sm text-muted">
                Context Grok will use when generating page content in Phase 2.
              </p>
            </div>
            <Field label="Company / Business Name">
              <input
                className={inputClass}
                value={form.businessName}
                onChange={(e) => patch({ businessName: e.target.value })}
              />
            </Field>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-700">
                  Logo URL
                </label>
                <p className="text-xs text-muted">
                  Optional — sets the WordPress site logo and in-page logo slots. Uploaded
                  file takes precedence over URL. Phase 2 also samples this file for brand
                  colors (buttons, headings, section bands).
                </p>
                <input
                  className={inputClass}
                  value={form.businessLogoUrl}
                  onChange={(e) => patch({ businessLogoUrl: e.target.value })}
                  placeholder="https://yoursite.com/logo.png"
                  disabled={Boolean(form.businessLogoFilePath)}
                />
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">Logo file</p>
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-slate-50 px-4 py-8 text-center transition hover:border-primary/50 hover:bg-slate-100">
                  <Upload className="mb-2 h-6 w-6 text-muted" />
                  <span className="text-sm font-medium text-slate-700">
                    {uploadingLogo ? "Uploading…" : "Upload PNG, JPG, WebP, or SVG"}
                  </span>
                  <span className="mt-1 text-xs text-muted">Max 5MB</span>
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
                    className="sr-only"
                    disabled={uploadingLogo || removingLogo}
                    onChange={(e) => uploadLogo(e.target.files?.[0] ?? null)}
                  />
                </label>
                {form.businessLogoFilePath ? (
                  <p className="mt-2 text-xs text-muted">
                    Active logo:{" "}
                    <code className="rounded bg-slate-100 px-1 py-0.5">
                      {form.businessLogoFilePath}
                    </code>
                  </p>
                ) : null}
              </div>
            </div>
            {form.businessLogoUrl || form.businessLogoFilePath ? (
              <div className="rounded-xl border border-border bg-slate-50 p-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                  Logo preview
                </p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={uploadPreviewUrl(
                    form.businessLogoFilePath || form.businessLogoUrl
                  )}
                  alt="Logo preview"
                  className="max-h-16 max-w-[220px] object-contain"
                />
                <button
                  type="button"
                  className="mt-3 text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-60"
                  disabled={uploadingLogo || removingLogo}
                  onClick={() => void removeLogo()}
                >
                  {removingLogo ? "Removing…" : "Remove logo"}
                </button>
              </div>
            ) : null}
            <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">
                Reference website design (screenshots)
              </h3>
              <p className="mt-1 text-xs text-muted">
                Required for screenshot-only builds (no theme zip): upload full-page or
                section captures. Grok vision recreates this layout and styling in Phase 2.
                Up to 12 images. Uploading a new set <strong className="font-medium text-slate-700">replaces</strong>{" "}
                existing screenshots when you already have some saved — or use{" "}
                <strong className="font-medium text-slate-700">Add more</strong> to append.
                Copy and branding come from your business brief — not the reference site.
              </p>
              {!form.activeThemeZipPath && form.designReferencePaths.length > 0 ? (
                <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                  Screenshot-led mode active — no theme zip needed. Run Phase 2 after saving.
                </p>
              ) : null}
              {form.designReferencePaths.length > 0 ? (
                <label
                  className={`mt-4 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 px-4 py-6 text-center transition ${
                    designRefBusy
                      ? "cursor-not-allowed opacity-60"
                      : "cursor-pointer hover:border-primary/60 hover:bg-primary/10"
                  }`}
                >
                  <Upload className="mb-2 h-6 w-6 text-primary" />
                  <span className="text-sm font-medium text-slate-800">
                    {designRefUploadMode === "replace"
                      ? "Uploading…"
                      : "Replace with new screenshots (removes current set)"}
                  </span>
                  <span className="mt-1 text-xs text-muted">
                    Up to 12 files · 8MB each · saves immediately
                  </span>
                  <input
                    ref={designRefReplaceInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    multiple
                    className="sr-only"
                    disabled={designRefBusy}
                    onChange={(e) =>
                      void uploadDesignReferences(e.target.files, "replace")
                    }
                  />
                </label>
              ) : null}
              {form.designReferencePaths.length < 12 ? (
                <label
                  className={`${form.designReferencePaths.length > 0 ? "mt-3" : "mt-4"} flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-slate-50 px-4 py-6 text-center transition ${
                    designRefBusy
                      ? "cursor-not-allowed opacity-60"
                      : "cursor-pointer hover:border-primary/50 hover:bg-slate-100"
                  }`}
                >
                  <Upload className="mb-2 h-6 w-6 text-muted" />
                  <span className="text-sm font-medium text-slate-700">
                    {designRefUploadMode === "add"
                      ? "Uploading…"
                      : form.designReferencePaths.length === 0
                        ? "Add reference screenshots (PNG, JPG, WebP)"
                        : "Add more screenshots (keeps existing)"}
                  </span>
                  <span className="mt-1 text-xs text-muted">
                    {form.designReferencePaths.length} of 12 · multiple files · 8MB
                    each
                  </span>
                  <input
                    ref={designRefAddInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    multiple
                    className="sr-only"
                    disabled={designRefBusy}
                    onChange={(e) =>
                      void uploadDesignReferences(e.target.files, "add")
                    }
                  />
                </label>
              ) : null}
              {form.designReferencePaths.length > 0 ? (
                <div className="mt-4 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {form.designReferencePaths.map((p) => (
                      <div
                        key={p}
                        className="overflow-hidden rounded-lg border border-border bg-slate-50"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={uploadPreviewUrl(p)}
                          alt="Design reference"
                          className="h-24 w-auto max-w-[160px] object-cover object-top"
                        />
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-60"
                    disabled={designRefBusy}
                    onClick={() => void clearDesignReferences()}
                  >
                    {clearingDesignRef
                      ? "Clearing…"
                      : "Clear all reference screenshots"}
                  </button>
                </div>
              ) : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Niche / Industry">
                <input
                  className={inputClass}
                  value={form.niche}
                  onChange={(e) => patch({ niche: e.target.value })}
                />
              </Field>
              <Field label="Tone of Voice">
                <input
                  className={inputClass}
                  value={form.toneOfVoice}
                  onChange={(e) => patch({ toneOfVoice: e.target.value })}
                  placeholder="Professional, friendly, authoritative…"
                />
              </Field>
            </div>
            <Field label="Target Audience">
              <textarea
                className={`${inputClass} min-h-[88px] resize-y`}
                value={form.targetAudience}
                onChange={(e) => patch({ targetAudience: e.target.value })}
              />
            </Field>
            <TagInput
              label="Core Services"
              hint="Comma-separated or press Enter after each service."
              tags={form.coreServices}
              onChange={(coreServices) => patch({ coreServices })}
            />
            <TagInput
              label="Target Keywords"
              tags={form.targetKeywords}
              onChange={(targetKeywords) => patch({ targetKeywords })}
            />
            <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">
                Site page images (optional)
              </h3>
              <p className="mt-1 text-xs text-muted">
                Upload photos for Phase 2/3 page slots instead of Grok image generation
                (saves time and avoids timeouts). Images are mapped to slots in order.
                You can also save a Google Drive folder link for your records — download
                and upload files here for reliable automation.
              </p>
              <Field label="Google Drive folder">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    className={inputClass}
                    value={form.pageImagesDriveFolderUrl}
                    onChange={(e) =>
                      patch({ pageImagesDriveFolderUrl: e.target.value })
                    }
                    placeholder="https://drive.google.com/drive/folders/…"
                  />
                  <button
                    type="button"
                    onClick={() => void importDriveImages("page")}
                    className="shrink-0 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/15"
                  >
                    Import from Drive
                  </button>
                </div>
              </Field>
              <label className="mt-3 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-slate-50 px-4 py-6 text-center hover:bg-slate-100">
                <Upload className="mb-2 h-6 w-6 text-muted" />
                <span className="text-sm font-medium text-slate-800">
                  Upload page images
                </span>
                <span className="text-xs text-muted">Up to 24 · 8MB each</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  className="sr-only"
                  onChange={(e) => void uploadPageImages(e.target.files)}
                />
              </label>
              {form.pageImageUploadPaths.length > 0 ? (
                <p className="mt-2 text-xs text-muted">
                  {form.pageImageUploadPaths.length} file(s) ready for Phase 2 (Grok
                  images skipped when this list is set).
                </p>
              ) : null}
            </div>
          </section>
        )}

        {activeTab === "pages" && (
          <section className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Page Structure</h2>
              <p className="text-sm text-muted">
                Select standard pages and add custom slugs for Phase 1 scaffolding.
              </p>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {STANDARD_PAGE_OPTIONS.map((page) => (
                <li key={page}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-white px-4 py-3 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={form.pagesToBuild.includes(page)}
                      onChange={() => togglePage(page)}
                      className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                    />
                    <span className="text-sm font-medium text-slate-800">{page}</span>
                  </label>
                </li>
              ))}
            </ul>
            {customPages.length > 0 ? (
              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">Custom pages</p>
                <ul className="flex flex-wrap gap-2">
                  {customPages.map((page) => (
                    <li
                      key={page}
                      className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-sm text-primary"
                    >
                      {page}
                      <button
                        type="button"
                        className="hover:text-primary-hover"
                        onClick={() => togglePage(page)}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Field label="Add Custom Page">
                <input
                  className={inputClass}
                  value={customPage}
                  onChange={(e) => setCustomPage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustomPage();
                    }
                  }}
                  placeholder="e.g. Pricing, Blog Landing"
                />
              </Field>
              <button
                type="button"
                onClick={addCustomPage}
                className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 sm:mb-0.5"
              >
                Add Page
              </button>
            </div>
          </section>
        )}

        {activeTab === "blog" && (
          <section className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Blog Generation (Phase 4)
              </h2>
              <p className="text-sm text-muted">
                One blog per run. Fill the manual fields below to rewrite a reference
                article with your keywords and 3 uploaded images (no Grok image generation).
                Leave manual fields empty to auto-generate topics from the business brief.
              </p>
            </div>
            <Field label="Content topic (manual run title)">
              <input
                className={inputClass}
                value={form.blogRunContentTopic}
                onChange={(e) => patch({ blogRunContentTopic: e.target.value })}
                placeholder="e.g. 3D Printing Plastics: Complete Materials Guide 2024"
              />
            </Field>
            <Field label="LSI / keywords (comma-separated)">
              <input
                className={inputClass}
                value={form.blogRunKeywords}
                onChange={(e) => patch({ blogRunKeywords: e.target.value })}
                placeholder="ABS Plastic 3D Printing Service, …"
              />
            </Field>
            <Field label="Reference blog URL (already made article)">
              <input
                className={inputClass}
                value={form.blogReferencePostUrl}
                onChange={(e) => patch({ blogReferencePostUrl: e.target.value })}
                placeholder="https://example.com/blogs/…"
              />
            </Field>
            <Field label="Google Drive folder (your 3 blog images)">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  className={inputClass}
                  value={form.blogImagesDriveFolderUrl}
                  onChange={(e) =>
                    patch({ blogImagesDriveFolderUrl: e.target.value })
                  }
                  placeholder="https://drive.google.com/drive/folders/…"
                />
                <button
                  type="button"
                  onClick={() => void importDriveImages("blog")}
                  className="shrink-0 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/15"
                >
                  Import from Drive
                </button>
              </div>
              <p className="mt-1 text-xs text-muted">
                Folder must be viewable by anyone with the link (up to 3 images).
              </p>
            </Field>
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-slate-50 px-4 py-6 text-center hover:bg-slate-100">
              <Upload className="mb-2 h-6 w-6 text-muted" />
              <span className="text-sm font-medium text-slate-800">
                Upload up to 3 blog images
              </span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                className="sr-only"
                onChange={(e) => void uploadBlogImages(e.target.files)}
              />
            </label>
            {form.blogRunImagePaths.length > 0 ? (
              <p className="text-xs text-muted">
                {form.blogRunImagePaths.length} image(s) stored for this run.
              </p>
            ) : null}
            <Field label="Blog category (optional)">
              <input
                type="text"
                className={inputClass}
                placeholder="Leave empty — Grok picks a category per post"
                value={form.blogCategory}
                onChange={(e) => patch({ blogCategory: e.target.value })}
              />
              <p className="mt-1 text-xs text-muted">
                When set, every post in the run is assigned this WordPress
                category. Save settings to keep it for later runs.
              </p>
            </Field>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-white px-4 py-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300 text-primary"
                checked={form.blogRequireApproval}
                onChange={(e) =>
                  patch({ blogRequireApproval: e.target.checked })
                }
              />
              <span>
                <span className="block text-sm font-medium text-slate-800">
                  Require human approval
                </span>
                <span className="text-xs text-muted">
                  When enabled, posts are saved as WordPress drafts instead of
                  publishing immediately.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-white px-4 py-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300 text-primary"
                checked={form.blogIncludeExternalLinks}
                onChange={(e) =>
                  patch({ blogIncludeExternalLinks: e.target.checked })
                }
              />
              <span>
                <span className="block text-sm font-medium text-slate-800">
                  Include external reference links
                </span>
                <span className="text-xs text-muted">
                  Adds 1–2 reputable outbound links alongside internal page links.
                </span>
              </span>
            </label>
            <button
              type="button"
              onClick={launchBlogPipeline}
              disabled={!connectionsVerified || isPipelineRunning}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPipelineRunning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Newspaper className="h-4 w-4" />
              )}
              Run Phase 4 Blog Pipeline
            </button>
            {jobHistory?.blogPosts?.length ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700">
                  Recent blog jobs
                </p>
                <ul className="divide-y divide-border rounded-lg border border-border bg-white text-sm">
                  {jobHistory.blogPosts.slice(0, 8).map((job) => (
                    <li
                      key={job.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                    >
                      <span className="text-slate-800">
                        {job.title || job.topic}
                      </span>
                      <span className="text-xs uppercase tracking-wide text-muted">
                        {job.status}
                        {job.wpPostId ? ` · #${job.wpPostId}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        )}

        {activeTab === "maintenance" && (
          <section className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Content Updates (Phase 5)
              </h2>
              <p className="text-sm text-muted">
                Identify stale pages/posts, regenerate with Grok, run SEO
                validation, then publish or save as drafts.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Stale after (days)">
                <input
                  type="number"
                  min={7}
                  max={730}
                  className={inputClass}
                  value={form.updateMaxAgeDays}
                  onChange={(e) =>
                    patch({ updateMaxAgeDays: Number(e.target.value) || 90 })
                  }
                />
              </Field>
              <Field label="Max items per run">
                <input
                  type="number"
                  min={1}
                  max={20}
                  className={inputClass}
                  value={form.updateMaxItemsPerRun}
                  onChange={(e) =>
                    patch({
                      updateMaxItemsPerRun: Number(e.target.value) || 5,
                    })
                  }
                />
              </Field>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-white px-4 py-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300 text-primary"
                checked={form.updateRequireApproval}
                onChange={(e) =>
                  patch({ updateRequireApproval: e.target.checked })
                }
              />
              <span>
                <span className="block text-sm font-medium text-slate-800">
                  Require human approval
                </span>
                <span className="text-xs text-muted">
                  Save refreshed content as drafts for review instead of live
                  publish.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-white px-4 py-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300 text-primary"
                checked={form.updateRefreshPages}
                onChange={(e) =>
                  patch({ updateRefreshPages: e.target.checked })
                }
              />
              <span className="text-sm font-medium text-slate-800">
                Refresh site pages
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-white px-4 py-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300 text-primary"
                checked={form.updateRefreshPosts}
                onChange={(e) =>
                  patch({ updateRefreshPosts: e.target.checked })
                }
              />
              <span className="text-sm font-medium text-slate-800">
                Refresh blog posts
              </span>
            </label>
            <button
              type="button"
              onClick={launchContentUpdate}
              disabled={!connectionsVerified || isPipelineRunning}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPipelineRunning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Run Phase 5 Content Update
            </button>
            {jobHistory?.contentUpdates?.length ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700">
                  Recent update jobs
                </p>
                <ul className="divide-y divide-border rounded-lg border border-border bg-white text-sm">
                  {jobHistory.contentUpdates.slice(0, 8).map((job) => (
                    <li key={job.id} className="space-y-0.5 px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-slate-800">{job.title}</span>
                        <span className="text-xs uppercase tracking-wide text-muted">
                          {job.contentType} · {job.status}
                        </span>
                      </div>
                      <p className="text-xs text-muted">{job.reason}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        )}

        {activeTab === "social" && (
          <section className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Social Media (Phase 6)
              </h2>
              <p className="text-sm text-muted">
                Off by default so Phases 1–5 keep working unchanged. With{" "}
                <strong>manual blog</strong> (Phase 4), captions for X, LinkedIn,
                Facebook, and Instagram are generated together and published
                immediately when API tokens are set (one random uploaded blog image
                per run).
              </p>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-white px-4 py-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300 text-primary"
                checked={form.socialEnabled}
                onChange={(e) => patch({ socialEnabled: e.target.checked })}
              />
              <span>
                <span className="block text-sm font-medium text-slate-800">
                  Enable social automation
                </span>
                <span className="text-xs text-muted">
                  Required before Phase 6 generate / E2E social steps run.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-white px-4 py-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300 text-primary"
                checked={form.socialAutoGenerateOnBlog}
                onChange={(e) =>
                  patch({ socialAutoGenerateOnBlog: e.target.checked })
                }
              />
              <span className="text-sm font-medium text-slate-800">
                Auto-generate after new blogs
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-white px-4 py-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300 text-primary"
                checked={form.socialAutoGenerateOnUpdate}
                onChange={(e) =>
                  patch({ socialAutoGenerateOnUpdate: e.target.checked })
                }
              />
              <span className="text-sm font-medium text-slate-800">
                Auto-generate after content updates
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-white px-4 py-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300 text-primary"
                checked={form.socialRequireApproval}
                onChange={(e) =>
                  patch({ socialRequireApproval: e.target.checked })
                }
              />
              <span>
                <span className="block text-sm font-medium text-slate-800">
                  Require approval before publishing
                </span>
                <span className="text-xs text-muted">
                  Saves captions as drafts for Phase 8 review when enabled.
                </span>
              </span>
            </label>
            <Field label="Schedule delay (hours)">
              <input
                type="number"
                min={0}
                max={168}
                className={inputClass}
                value={form.socialScheduleDelayHours}
                onChange={(e) =>
                  patch({
                    socialScheduleDelayHours: Number(e.target.value) || 0,
                  })
                }
              />
            </Field>
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">Platforms</p>
              <ul className="flex flex-wrap gap-2">
                {SOCIAL_PLATFORM_OPTIONS.map((platform) => (
                  <li key={platform}>
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border bg-white px-3 py-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={form.socialPlatforms.includes(platform)}
                        onChange={() => toggleSocialPlatform(platform)}
                      />
                      {platform}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="X (Twitter) access token">
                <input
                  type="password"
                  className={inputClass}
                  value={form.socialXAccessToken}
                  onChange={(e) =>
                    patch({ socialXAccessToken: e.target.value })
                  }
                  autoComplete="off"
                />
              </Field>
              <Field label="LinkedIn access token">
                <input
                  type="password"
                  className={inputClass}
                  value={form.socialLinkedInAccessToken}
                  onChange={(e) =>
                    patch({ socialLinkedInAccessToken: e.target.value })
                  }
                  autoComplete="off"
                />
              </Field>
              <Field label="LinkedIn author URN">
                <input
                  className={inputClass}
                  value={form.socialLinkedInAuthorUrn}
                  onChange={(e) =>
                    patch({ socialLinkedInAuthorUrn: e.target.value })
                  }
                  placeholder="urn:li:person:..."
                />
              </Field>
              <Field label="Facebook page token">
                <input
                  type="password"
                  className={inputClass}
                  value={form.socialFacebookPageToken}
                  onChange={(e) =>
                    patch({ socialFacebookPageToken: e.target.value })
                  }
                  autoComplete="off"
                />
              </Field>
              <Field label="Facebook page ID">
                <input
                  className={inputClass}
                  value={form.socialFacebookPageId}
                  onChange={(e) =>
                    patch({ socialFacebookPageId: e.target.value })
                  }
                />
              </Field>
              <Field label="Instagram business account ID">
                <input
                  className={inputClass}
                  value={form.socialInstagramAccountId}
                  onChange={(e) =>
                    patch({ socialInstagramAccountId: e.target.value })
                  }
                />
              </Field>
            </div>
            <p className="text-xs text-muted">
              Without API tokens, captions are still generated and stored for
              scheduled/manual posting.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => launchSocial("generate")}
                disabled={
                  !connectionsVerified ||
                  isPipelineRunning ||
                  !form.socialEnabled
                }
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Share2 className="h-4 w-4" />
                Generate from latest blog
              </button>
              <button
                type="button"
                onClick={() => launchSocial("flush")}
                disabled={!connectionsVerified || isPipelineRunning}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
              >
                Flush scheduled posts
              </button>
            </div>
            {jobHistory?.socialPosts?.length ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700">
                  Recent social jobs
                </p>
                <ul className="divide-y divide-border rounded-lg border border-border bg-white text-sm">
                  {jobHistory.socialPosts.slice(0, 8).map((job) => (
                    <li
                      key={job.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                    >
                      <span className="text-slate-800">
                        {job.platform}
                        {job.sourceTitle ? ` · ${job.sourceTitle}` : ""}
                      </span>
                      <span className="text-xs uppercase text-muted">
                        {job.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        )}

        {activeTab === "e2e" && (
          <section className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                End-to-End Workflow (Phase 7)
              </h2>
              <p className="text-sm text-muted">
                Chains existing phases: setup → content → SEO → live → blogs →
                social → optional ongoing updates. Standalone Phase 1–5 buttons
                remain unchanged.
              </p>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-white px-4 py-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300 text-primary"
                checked={form.e2eIncludeBlog}
                onChange={(e) => patch({ e2eIncludeBlog: e.target.checked })}
              />
              <span className="text-sm font-medium text-slate-800">
                Include blog generation (Phase 4)
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-white px-4 py-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300 text-primary"
                checked={form.e2eIncludeContentUpdate}
                onChange={(e) =>
                  patch({ e2eIncludeContentUpdate: e.target.checked })
                }
              />
              <span className="text-sm font-medium text-slate-800">
                Include content updates (Phase 5)
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-white px-4 py-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300 text-primary"
                checked={form.e2eIncludeSocial}
                onChange={(e) => patch({ e2eIncludeSocial: e.target.checked })}
              />
              <span className="text-sm font-medium text-slate-800">
                Include social generation (Phase 6, requires Social enabled)
              </span>
            </label>
            <button
              type="button"
              onClick={launchE2E}
              disabled={!connectionsVerified || isPipelineRunning}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPipelineRunning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <GitBranch className="h-4 w-4" />
              )}
              Run full E2E pipeline
            </button>
          </section>
        )}

        {activeTab === "manage" && (
          <ManagementPanel
            onBanner={(b) => {
              setBanner(b);
            }}
          />
        )}
      </div>

      <TerminalLogger
        className="mt-8"
        logs={logs}
        status={isPipelineRunning ? "RUNNING" : pipelineStatus}
        onClear={() => {
          setLogs([]);
          if (!isPipelineRunning) {
            setPipelineStatus("IDLE");
          }
        }}
      />

      <footer className="mt-8 flex flex-col gap-3 rounded-2xl border border-border bg-card p-6 shadow-sm">
        <p className="text-sm text-muted">
          {connectionsVerified
            ? "Run phases individually (e.g. re-run Phase 2 only) or use Phases 1–3 for a full site build."
            : "Run connection tests on the Credentials tab before launching automation."}
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={saveConfiguration}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-5 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save Configuration
          </button>
          <button
            type="button"
            onClick={launchPhase1}
            disabled={!connectionsVerified || isPipelineRunning}
            className="inline-flex items-center gap-2 rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-2.5 text-sm font-semibold text-cyan-900 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Phase 1 Setup
          </button>
          <button
            type="button"
            onClick={launchPhase2}
            disabled={!connectionsVerified || isPipelineRunning}
            title="Regenerate page content only (requires Phase 1 pages)"
            className="inline-flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm font-semibold text-sky-900 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Phase 2 Content
          </button>
          <button
            type="button"
            onClick={launchPhase3}
            disabled={!connectionsVerified || isPipelineRunning}
            title="SEO audit and publish existing page content"
            className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-semibold text-violet-900 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Phase 3 Publish
          </button>
          <button
            type="button"
            onClick={launchAutomation}
            disabled={!connectionsVerified || isPipelineRunning}
            title={
              connectionsVerified
                ? undefined
                : "Pass Grok and WordPress connection tests first"
            }
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPipelineRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Rocket className="h-4 w-4" />
            )}
            Phases 1–3 (all)
          </button>
          <button
            type="button"
            onClick={launchBlogPipeline}
            disabled={!connectionsVerified || isPipelineRunning}
            className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-5 py-2.5 text-sm font-semibold text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Newspaper className="h-4 w-4" />
            Phase 4 Blog
          </button>
          <button
            type="button"
            onClick={launchContentUpdate}
            disabled={!connectionsVerified || isPipelineRunning}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FilePenLine className="h-4 w-4" />
            Phase 5 Updates
          </button>
          <button
            type="button"
            onClick={() => launchSocial("generate")}
            disabled={
              !connectionsVerified || isPipelineRunning || !form.socialEnabled
            }
            className="inline-flex items-center gap-2 rounded-lg border border-pink-200 bg-pink-50 px-5 py-2.5 text-sm font-semibold text-pink-800 hover:bg-pink-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Share2 className="h-4 w-4" />
            Phase 6 Social
          </button>
          <button
            type="button"
            onClick={launchE2E}
            disabled={!connectionsVerified || isPipelineRunning}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-2.5 text-sm font-semibold text-emerald-900 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <GitBranch className="h-4 w-4" />
            Phase 7 E2E
          </button>
          <button
            type="button"
            onClick={() => void resetAll()}
            disabled={isPipelineRunning}
            className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-5 py-2.5 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            RESET ALL
          </button>
        </div>
      </footer>
    </div>
  );
}
