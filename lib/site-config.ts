import type { SiteStatus } from "@prisma/client";

export const DEFAULT_PAGES = [
  "Home",
  "About",
  "Services",
  "Contact",
  "FAQ",
] as const;

export const STANDARD_PAGE_OPTIONS = [...DEFAULT_PAGES];

export type SiteConfigInput = {
  id?: string;
  xaiApiKey: string;
  wpUrl: string;
  wpUsername: string;
  wpAppPassword: string;
  sftpHost?: string | null;
  sftpPort?: string | null;
  sftpUsername?: string | null;
  sftpPassword?: string | null;
  businessName: string;
  businessLogoUrl?: string | null;
  businessLogoFilePath?: string | null;
  designReferencePaths?: string[];
  niche: string;
  targetAudience: string;
  toneOfVoice: string;
  coreServices: string[];
  targetKeywords: string[];
  pagesToBuild: string[];
  activeThemeZipPath?: string | null;
  status?: SiteStatus;
  blogPostsPerRun?: number;
  blogRequireApproval?: boolean;
  blogIncludeExternalLinks?: boolean;
  updateMaxAgeDays?: number;
  updateRequireApproval?: boolean;
  updateRefreshPages?: boolean;
  updateRefreshPosts?: boolean;
  updateMaxItemsPerRun?: number;
  socialEnabled?: boolean;
  socialAutoGenerateOnBlog?: boolean;
  socialAutoGenerateOnUpdate?: boolean;
  socialRequireApproval?: boolean;
  socialPlatforms?: string[];
  socialScheduleDelayHours?: number;
  socialXAccessToken?: string | null;
  socialLinkedInAccessToken?: string | null;
  socialLinkedInAuthorUrn?: string | null;
  socialFacebookPageToken?: string | null;
  socialFacebookPageId?: string | null;
  socialInstagramAccountId?: string | null;
  e2eIncludeBlog?: boolean;
  e2eIncludeContentUpdate?: boolean;
  e2eIncludeSocial?: boolean;
};

export const SINGLE_CONFIG_ID = "default";

export function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function siteConfigToClient(config: {
  id: string;
  xaiApiKey: string;
  wpUrl: string;
  wpUsername: string;
  wpAppPassword: string;
  sftpHost: string | null;
  sftpPort: string | null;
  sftpUsername: string | null;
  sftpPassword: string | null;
  businessName: string;
  businessLogoUrl?: string | null;
  businessLogoFilePath?: string | null;
  wpLogoMediaId?: number | null;
  designReferencePaths?: unknown;
  niche: string;
  targetAudience: string;
  toneOfVoice: string;
  coreServices: unknown;
  targetKeywords: unknown;
  pagesToBuild: unknown;
  activeThemeZipPath: string | null;
  status: SiteStatus;
  blogPostsPerRun: number;
  blogRequireApproval: boolean;
  blogIncludeExternalLinks: boolean;
  updateMaxAgeDays: number;
  updateRequireApproval: boolean;
  updateRefreshPages: boolean;
  updateRefreshPosts: boolean;
  updateMaxItemsPerRun: number;
  socialEnabled: boolean;
  socialAutoGenerateOnBlog: boolean;
  socialAutoGenerateOnUpdate: boolean;
  socialRequireApproval: boolean;
  socialPlatforms: unknown;
  socialScheduleDelayHours: number;
  socialXAccessToken: string | null;
  socialLinkedInAccessToken: string | null;
  socialLinkedInAuthorUrn: string | null;
  socialFacebookPageToken: string | null;
  socialFacebookPageId: string | null;
  socialInstagramAccountId: string | null;
  e2eIncludeBlog: boolean;
  e2eIncludeContentUpdate: boolean;
  e2eIncludeSocial: boolean;
}) {
  return {
    ...config,
    businessLogoUrl: config.businessLogoUrl ?? null,
    businessLogoFilePath: config.businessLogoFilePath ?? null,
    wpLogoMediaId: config.wpLogoMediaId ?? null,
    designReferencePaths: parseStringArray(config.designReferencePaths),
    coreServices: parseStringArray(config.coreServices),
    targetKeywords: parseStringArray(config.targetKeywords),
    pagesToBuild: parseStringArray(config.pagesToBuild),
    socialPlatforms: parseStringArray(config.socialPlatforms),
  };
}

export function normalizeMaintenanceSettings(body: SiteConfigInput) {
  const platforms = parseStringArray(body.socialPlatforms);
  return {
    blogPostsPerRun: clampInt(body.blogPostsPerRun, 3, 1, 10),
    blogRequireApproval: body.blogRequireApproval !== false,
    blogIncludeExternalLinks: body.blogIncludeExternalLinks !== false,
    updateMaxAgeDays: clampInt(body.updateMaxAgeDays, 90, 7, 730),
    updateRequireApproval: body.updateRequireApproval !== false,
    updateRefreshPages: body.updateRefreshPages !== false,
    updateRefreshPosts: body.updateRefreshPosts !== false,
    updateMaxItemsPerRun: clampInt(body.updateMaxItemsPerRun, 5, 1, 20),
    socialEnabled: body.socialEnabled === true,
    socialAutoGenerateOnBlog: body.socialAutoGenerateOnBlog !== false,
    socialAutoGenerateOnUpdate: body.socialAutoGenerateOnUpdate === true,
    socialRequireApproval: body.socialRequireApproval !== false,
    socialPlatforms:
      platforms.length > 0
        ? platforms
        : ["x", "linkedin", "facebook", "instagram"],
    socialScheduleDelayHours: clampInt(body.socialScheduleDelayHours, 1, 0, 168),
    socialXAccessToken: body.socialXAccessToken?.trim() || null,
    socialLinkedInAccessToken: body.socialLinkedInAccessToken?.trim() || null,
    socialLinkedInAuthorUrn: body.socialLinkedInAuthorUrn?.trim() || null,
    socialFacebookPageToken: body.socialFacebookPageToken?.trim() || null,
    socialFacebookPageId: body.socialFacebookPageId?.trim() || null,
    socialInstagramAccountId: body.socialInstagramAccountId?.trim() || null,
    e2eIncludeBlog: body.e2eIncludeBlog !== false,
    e2eIncludeContentUpdate: body.e2eIncludeContentUpdate === true,
    e2eIncludeSocial: body.e2eIncludeSocial !== false,
  };
}
