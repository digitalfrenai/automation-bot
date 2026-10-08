import type { ContentFormat } from "@/lib/content-format";

export type PipelinePhase =
  | "setup"
  | "phase1"
  | "phase2"
  | "phase3"
  | "phase4"
  | "phase5"
  | "phase6"
  | "phase7"
  | "complete";

export type PipelineLogLevel = "info" | "warn" | "error";

export type PipelineLogEntry = {
  timestamp: string;
  level: PipelineLogLevel;
  phase?: PipelinePhase;
  message: string;
  pageTitle?: string;
  pageId?: number;
};

export type PipelineStatus = {
  dbStatus: string;
  log: PipelineLogEntry;
};

export type ScaffoledPage = {
  id: number;
  /** Stable label from pagesToBuild (e.g. "About"), not the SEO title in WordPress. */
  title: string;
  scaffoldTitle: string;
  slug: string;
  status: string;
};

export type Phase2Result = {
  pageId: number;
  pageTitle: string;
  html: string;
  contentFormat?: ContentFormat;
  auditHtml?: string;
};

export type SeoValidationPayload = {
  seo_title: string;
  meta_description: string;
  slug: string;
  h1_count: number;
  heading_hierarchy_valid: boolean;
  keyword_density_passed: boolean;
  validation_passed: boolean;
  corrected_html: string;
  simple_fixes_applied?: string[];
};

export type BlogTopic = {
  topic: string;
  keyword: string;
  angle: string;
  category: string;
  tags: string[];
};

export type Phase4PostResult = {
  topic: string;
  keyword: string;
  wpPostId: number;
  title: string;
  slug: string;
  status: "draft" | "publish";
  seoPassed: boolean;
  blogPostRecordId?: string;
};

export type ContentUpdateCandidate = {
  contentType: "page" | "post";
  wpId: number;
  title: string;
  slug: string;
  modified: string;
  reason: string;
  html: string;
};

export type Phase5UpdateResult = {
  contentType: "page" | "post";
  wpId: number;
  title: string;
  status: "draft" | "publish" | "skipped" | "failed";
  reason: string;
};

export type SocialPlatformVariant = {
  platform: "x" | "linkedin" | "facebook" | "instagram";
  caption: string;
  hashtags: string[];
  promotionalSnippet: string;
};
