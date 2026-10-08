import { loadSiteConfig } from "@/lib/config-loader";
import { prisma } from "@/lib/prisma";
import { ensureSiteConfigJsonIntegrity } from "@/lib/repair-site-config";
import {
  publishToSocialPlatform,
  type SocialPlatform,
} from "@/lib/social-publishers";
import { wpRequest, type WpPost } from "@/lib/wordpress-client";
import { SINGLE_CONFIG_ID } from "@/lib/site-config";

/** Phase 8 — aggregated management snapshot for the dashboard. */
export async function getManagementOverview(configId = SINGLE_CONFIG_ID) {
  await ensureSiteConfigJsonIntegrity(configId);

  const config = await prisma.siteConfig.findUnique({
    where: { id: configId },
  });

  const social = (
    prisma as unknown as {
      socialPostRecord?: {
        findMany: (args: unknown) => Promise<unknown[]>;
      };
    }
  ).socialPostRecord;
  const tasks = (
    prisma as unknown as {
      automationTask?: {
        findMany: (args: unknown) => Promise<unknown[]>;
      };
    }
  ).automationTask;

  const empty: never[] = [];

  const [
    blogDrafts,
    blogRecent,
    updateDrafts,
    socialDrafts,
    socialScheduled,
    socialRecent,
    failedTasks,
  ] = await Promise.all([
    prisma.blogPostRecord.findMany({
      where: { siteConfigId: configId, status: "draft" },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.blogPostRecord.findMany({
      where: { siteConfigId: configId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.contentUpdateRecord.findMany({
      where: { siteConfigId: configId, status: "draft" },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    social
      ? social.findMany({
          where: { siteConfigId: configId, status: "draft" },
          orderBy: { createdAt: "desc" },
          take: 30,
        })
      : Promise.resolve(empty),
    social
      ? social.findMany({
          where: { siteConfigId: configId, status: "scheduled" },
          orderBy: { scheduledAt: "asc" },
          take: 30,
        })
      : Promise.resolve(empty),
    social
      ? social.findMany({
          where: { siteConfigId: configId },
          orderBy: { createdAt: "desc" },
          take: 15,
        })
      : Promise.resolve(empty),
    tasks
      ? tasks.findMany({
          where: { siteConfigId: configId, status: "failed" },
          orderBy: { createdAt: "desc" },
          take: 20,
        })
      : Promise.resolve(empty),
  ]);

  return {
    websiteStatus: config?.status ?? "IDLE",
    approvals: {
      blogRequireApproval: config?.blogRequireApproval ?? true,
      updateRequireApproval: config?.updateRequireApproval ?? true,
      socialRequireApproval: config?.socialRequireApproval ?? true,
      socialEnabled: config?.socialEnabled ?? false,
      socialAutoGenerateOnBlog: config?.socialAutoGenerateOnBlog ?? true,
      socialAutoGenerateOnUpdate: config?.socialAutoGenerateOnUpdate ?? false,
    },
    schedules: {
      updateMaxAgeDays: config?.updateMaxAgeDays ?? 90,
      updateMaxItemsPerRun: config?.updateMaxItemsPerRun ?? 5,
      socialScheduleDelayHours: config?.socialScheduleDelayHours ?? 1,
      e2eIncludeBlog: config?.e2eIncludeBlog ?? true,
      e2eIncludeContentUpdate: config?.e2eIncludeContentUpdate ?? false,
      e2eIncludeSocial: config?.e2eIncludeSocial ?? true,
    },
    pending: {
      blogs: blogDrafts,
      contentUpdates: updateDrafts,
      socialPosts: (socialDrafts ?? []) as typeof blogDrafts,
    },
    scheduledSocial: (socialScheduled ?? []) as typeof blogDrafts,
    recent: {
      blogs: blogRecent,
      socialPosts: (socialRecent ?? []) as typeof blogDrafts,
    },
    failedTasks: (failedTasks ?? []) as typeof blogDrafts,
  };
}

export async function approveBlogPost(recordId: string) {
  const record = await prisma.blogPostRecord.findUnique({
    where: { id: recordId },
  });
  if (!record?.wpPostId) {
    throw new Error("Blog record or WordPress post id missing.");
  }

  const config = await loadSiteConfig(record.siteConfigId);
  await wpRequest<WpPost>(
    config,
    `/wp-json/wp/v2/posts/${record.wpPostId}?context=edit`,
    {
      method: "POST",
      body: JSON.stringify({ status: "publish" }),
    }
  );

  return prisma.blogPostRecord.update({
    where: { id: recordId },
    data: { status: "publish" },
  });
}

export async function approveContentUpdate(recordId: string) {
  const record = await prisma.contentUpdateRecord.findUnique({
    where: { id: recordId },
  });
  if (!record) {
    throw new Error("Content update record not found.");
  }

  const config = await loadSiteConfig(record.siteConfigId);
  const path =
    record.contentType === "post"
      ? `/wp-json/wp/v2/posts/${record.wpId}?context=edit`
      : `/wp-json/wp/v2/pages/${record.wpId}?context=edit`;

  await wpRequest(config, path, {
    method: "POST",
    body: JSON.stringify({ status: "publish" }),
  });

  return prisma.contentUpdateRecord.update({
    where: { id: recordId },
    data: { status: "publish" },
  });
}

export async function approveSocialPost(
  recordId: string,
  options?: { publishNow?: boolean; scheduleHours?: number }
) {
  const record = await prisma.socialPostRecord.findUnique({
    where: { id: recordId },
  });
  if (!record) {
    throw new Error("Social post not found.");
  }

  const config = await loadSiteConfig(record.siteConfigId);
  const publishNow = options?.publishNow === true;
  const hours =
    typeof options?.scheduleHours === "number"
      ? options.scheduleHours
      : config.socialScheduleDelayHours;

  if (publishNow) {
    const hashtags = Array.isArray(record.hashtags)
      ? (record.hashtags as string[])
      : [];
    const result = await publishToSocialPlatform(
      config,
      record.platform as SocialPlatform,
      record.caption,
      hashtags,
      {
        imageUrl: record.mediaUrl ?? undefined,
        linkUrl: record.sourceUrl ?? undefined,
      }
    );

    if (result.ok) {
      return prisma.socialPostRecord.update({
        where: { id: recordId },
        data: {
          status: "published",
          publishedAt: new Date(),
          externalPostId: result.externalPostId ?? null,
          errorMessage: null,
          requireApproval: false,
        },
      });
    }

    if (result.skipped) {
      return prisma.socialPostRecord.update({
        where: { id: recordId },
        data: {
          status: "scheduled",
          scheduledAt: new Date(Date.now() + Math.max(0, hours) * 3600_000),
          errorMessage: result.error ?? null,
          requireApproval: false,
        },
      });
    }

    await prisma.automationTask.create({
      data: {
        siteConfigId: record.siteConfigId,
        phase: "social_publish",
        title: `${record.platform}: ${record.sourceTitle ?? recordId}`,
        status: "failed",
        message: result.error,
      },
    });

    return prisma.socialPostRecord.update({
      where: { id: recordId },
      data: {
        status: "failed",
        errorMessage: result.error ?? "Publish failed.",
      },
    });
  }

  return prisma.socialPostRecord.update({
    where: { id: recordId },
    data: {
      status: "scheduled",
      scheduledAt: new Date(Date.now() + Math.max(0, hours) * 3600_000),
      requireApproval: false,
    },
  });
}

export async function rejectSocialPost(recordId: string) {
  return prisma.socialPostRecord.update({
    where: { id: recordId },
    data: { status: "cancelled" },
  });
}
