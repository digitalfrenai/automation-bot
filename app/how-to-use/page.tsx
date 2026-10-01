import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  Bug,
  ClipboardList,
  KeyRound,
  Lightbulb,
  Rocket,
} from "lucide-react";

export const metadata: Metadata = {
  title: "How to Use — WordPress Automation",
  description:
    "Step-by-step guide to configuring and running the Grok-powered WordPress automation platform.",
};

type Step = {
  title: string;
  where?: string;
  body: React.ReactNode;
};

const SETUP_STEPS: Step[] = [
  {
    title: "Start the app and open the dashboard",
    body: (
      <>
        <p>
          From PowerShell or Command Prompt in the project folder run{" "}
          <code>npm run dev</code> (Git Bash cannot launch npm here — use{" "}
          <code>npm.cmd run dev</code> there). Open{" "}
          <code>http://localhost:3000</code>. The first start takes 1–2 minutes
          while Next.js compiles and Prisma syncs the SQLite database.
        </p>
        <p>
          All settings are stored locally in the SQLite database, so you only
          configure once per site.
        </p>
      </>
    ),
  },
  {
    title: "Add credentials and test the connection",
    where: "Credentials tab",
    body: (
      <>
        <ul>
          <li>
            <strong>xAI API Key</strong> — from console.x.ai. Grok 4.6 is used for
            all content, SEO, and vision tasks.
          </li>
          <li>
            <strong>WordPress Site URL</strong> — the public URL of the site,
            e.g. <code>https://example.com</code>.
          </li>
          <li>
            <strong>WP Username + Application Password</strong> — in WordPress go
            to <em>Users → Profile → Application Passwords</em>, create one, and
            paste it (spaces are fine). The user must be an Administrator so the
            bot can create pages, upload media, and write Additional CSS.
          </li>
        </ul>
        <p>
          Click <strong>Test Connection</strong>. Both Grok and WordPress must pass
          — every phase button stays disabled until they do.
        </p>
      </>
    ),
  },
  {
    title: "Hosting & Theme (optional)",
    where: "Hosting & Theme tab",
    body: (
      <>
        <p>
          Add SFTP host, port, username, and password only if you want Phase 1 to
          upload and activate a theme zip for you. Drop the theme <code>.zip</code>{" "}
          (max 50 MB) into the upload box.
        </p>
        <p>
          You can skip this tab completely when you use reference screenshots
          (next step). The live WordPress theme still renders the header, menu,
          and footer — the bot only writes page content.
        </p>
      </>
    ),
  },
  {
    title: "Fill in the Business Brief",
    where: "Business Brief tab",
    body: (
      <>
        <ul>
          <li>
            <strong>Business name, niche, tone of voice, target audience</strong>{" "}
            — this is the only source of wording Grok uses. Be specific.
          </li>
          <li>
            <strong>Core services</strong> and <strong>target keywords</strong> —
            type each and press Enter. Keywords drive SEO titles, headings, and
            blog topics.
          </li>
          <li>
            <strong>Logo</strong> — upload a file or paste a URL. It becomes the
            WordPress site logo, and its colors are sampled for buttons, headings,
            and section bands.
          </li>
          <li>
            <strong>Reference website screenshots</strong> (up to 6, 8 MB each) —
            Grok vision recreates this layout and style. If no theme zip is
            uploaded, screenshot-led mode turns on automatically and the
            screenshots become the full design spec. Use 2–3 clear full-page
            screenshots; more images make Phase 2 slower.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: "Choose the pages to build",
    where: "Page Structure tab",
    body: (
      <>
        <p>
          Tick the standard pages (Home, About, Services, Contact, FAQ, Blog, …)
          and add any custom pages such as Pricing or Projects. Phase 1 creates a
          draft page for each one; Phase 2 fills it; Phase 3 publishes it.
        </p>
      </>
    ),
  },
  {
    title: "Save Configuration",
    where: "Footer button",
    body: (
      <p>
        Click <strong>Save Configuration</strong> after any change. Uploads
        (theme, logo, screenshots) are stored immediately, but text fields and
        toggles only persist when you save.
      </p>
    ),
  },
];

const BUILD_STEPS: Step[] = [
  {
    title: "Phase 1 Setup",
    where: "Footer → Phase 1 Setup",
    body: (
      <>
        <p>
          Deploys and activates the theme zip (if SFTP + zip are set), verifies
          the REST API, syncs the site logo, writes the bot's Additional CSS blocks
          (button spacing, brand colors, mobile layout), and creates one draft page
          per selected page. Existing pages with the same slug are reused, so
          re-running is safe.
        </p>
      </>
    ),
  },
  {
    title: "Phase 2 Content",
    where: "Footer → Phase 2 Content",
    body: (
      <>
        <p>
          For every scaffolded page Grok writes the full page body. The format is
          detected automatically — Gutenberg blocks, Elementor, Divi, or
          theme-styled HTML — and screenshot-led mode outputs responsive HTML that
          matches your reference images.
        </p>
        <p>
          After generation the bot binds Media Library images into the layout
          slots (so Elementor “Replace image” works in place), converts social
          links into icon buttons, and tags grids so they stack on phones.
        </p>
        <p>
          <strong>Expect several minutes per page</strong> when screenshots are
          attached — vision requests are large. Timeouts and connection errors are
          retried up to three times; the log shows each retry.
        </p>
        <p>
          Run Phase 2 on its own whenever you change the brief, logo, or
          screenshots. Pages keep their old markup until Phase 2 runs again.
        </p>
      </>
    ),
  },
  {
    title: "Phase 3 Publish",
    where: "Footer → Phase 3 Publish",
    body: (
      <>
        <p>
          Reads the current content of each page, asks Grok for an SEO title,
          meta description, and slug, adds any missing page images, and sets the
          page status to <strong>publish</strong>. Meta fields are written for
          Yoast and Rank Math when installed.
        </p>
        <p>
          Phase 3 also re-applies the layout fixes (mobile stacking, button
          spacing), so re-running Phase 3 alone is the fastest way to update
          already generated pages without regenerating copy.
        </p>
      </>
    ),
  },
  {
    title: "Phases 1–3 (all)",
    where: "Footer → Phases 1–3 (all)",
    body: (
      <p>
        Runs setup, content, and publish in sequence for a complete first build.
        Use the single-phase buttons afterwards for targeted re-runs.
      </p>
    ),
  },
];

const AUTOMATION_STEPS: Step[] = [
  {
    title: "Phase 4 — Blog generation",
    where: "Blog (Phase 4) tab",
    body: (
      <>
        <p>
          Set <strong>Posts per run</strong> (1–10). Grok proposes topics from your
          keywords and brief, writes structured blog HTML, runs the SEO audit, then
          publishes. Enable <strong>Require human approval</strong> to save posts as
          WordPress drafts for review instead. <strong>Include external reference
          links</strong> adds 1–2 reputable outbound links.
        </p>
        <p>Run it from the tab or the footer button “Phase 4 Blog”.</p>
      </>
    ),
  },
  {
    title: "Phase 5 — Content updates",
    where: "Updates (Phase 5) tab",
    body: (
      <p>
        Pages and posts older than <strong>Stale after (days)</strong> are
        refreshed with Grok, re-audited for SEO, and either auto-published or
        saved as drafts depending on the approval toggle. <strong>Max items per
        run</strong> caps how many are touched each time.
      </p>
    ),
  },
  {
    title: "Phase 6 — Social media (off by default)",
    where: "Social (Phase 6) tab",
    body: (
      <>
        <p>
          Tick <strong>Enable social automation</strong>, then choose whether
          captions are generated after new blogs and/or content updates. Add
          platform tokens (X, LinkedIn, Facebook page, Instagram business) to
          actually publish; without tokens, posts are prepared only.
        </p>
        <p>
          <strong>Require approval before publishing</strong> sends captions to the
          Manage tab as drafts. <strong>Schedule delay</strong> postpones publishing
          by the given hours.
        </p>
      </>
    ),
  },
  {
    title: "Phase 7 — End-to-end pipeline",
    where: "E2E (Phase 7) tab",
    body: (
      <p>
        Chains Phases 1–3 and optionally 4, 5, and 6 in one run. Tick the phases
        you want included and press <strong>Run full E2E pipeline</strong>. The
        standalone buttons keep working independently.
      </p>
    ),
  },
  {
    title: "Phase 8 — Manage & approvals",
    where: "Manage (Phase 8) tab",
    body: (
      <p>
        Shows website status, pending blog and content-update approvals (Approve
        & publish, Reject), scheduled social posts (Publish now), and failed
        automation tasks. Use it daily when approval toggles are on.
      </p>
    ),
  },
];

const TROUBLESHOOTING: { problem: string; fix: React.ReactNode }[] = [
  {
    problem: "“Request timed out” or “Connection error” during Phase 2",
    fix: (
      <>
        The request is retried automatically (up to 3 attempts). Vision calls can
        take several minutes; keep the browser tab open. Reduce the number of
        reference screenshots to 2–3 if it keeps happening. Timeout is controlled
        by <code>XAI_TIMEOUT_MS</code> (default 15 minutes).
      </>
    ),
  },
  {
    problem: "“Auth context expired” from xAI",
    fix: (
      <>
        Usually an oversized image payload, not a key problem. Screenshots are
        compressed before sending; if it persists, upload smaller or fewer
        screenshots.
      </>
    ),
  },
  {
    problem: "SEO step fails with “Unterminated string in JSON”",
    fix: (
      <>
        Grok's reply was cut off. Phase 3 now falls back to publishing the saved
        page with a title-based description — just re-run Phase 3 for that page.
      </>
    ),
  },
  {
    problem: "Pages look squeezed on mobile",
    fix: (
      <>
        Re-run <strong>Phase 3 Publish</strong>. It tags inline grids and flex
        columns and pushes the mobile CSS block into Additional CSS so sections
        stack below 782 px.
      </>
    ),
  },
  {
    problem: "Elementor “Replace image” puts the picture in the wrong place",
    fix: (
      <>
        Pages generated before image binding was added use raw <code>&lt;img&gt;</code>{" "}
        tags. Re-run Phase 2 for that page so images get Media Library IDs
        (<code>wp-image-###</code>) Elementor can replace in place.
      </>
    ),
  },
  {
    problem: "“Home” title band appears above page content (Kadence)",
    fix: (
      <>
        That is the theme's page title bar. Hide it in{" "}
        <em>Appearance → Customize → Page Layout → Page Title</em>, or per page
        under <em>Kadence Page Settings → Title → Hide</em>.
      </>
    ),
  },
  {
    problem: "“Fatal error: Call to undefined function is_shop()” on pages",
    fix: (
      <>
        The active theme calls WooCommerce functions without checking the plugin
        exists. Install WooCommerce or guard the call in the theme file named in
        the error. The generated content is not the cause.
      </>
    ),
  },
  {
    problem: "Uploading screenshots shows a Prisma JSON error",
    fix: (
      <>
        Older databases had an empty <code>designReferencePaths</code> column.
        The upload route repairs it automatically; restart the dev server and
        upload again.
      </>
    ),
  },
  {
    problem: "“Cannot find module npm-cli.js” when running npm",
    fix: (
      <>
        You are in Git Bash. Use PowerShell / Command Prompt, or run{" "}
        <code>npm.cmd run dev</code>.
      </>
    ),
  },
];

const TIPS: React.ReactNode[] = [
  <>
    Watch the <strong>log panel</strong> under the tabs. Each line is tagged
    with its phase and page; red lines are errors, amber lines are warnings and
    retries. A keep-alive is sent every 15 seconds during long runs.
  </>,
  <>
    Grok never copies text from reference screenshots — all copy comes from the
    brief, so a richer brief gives better pages.
  </>,
  <>
    Additional CSS blocks written by the bot are marked{" "}
    <code>/* wp-bot-content-buttons */</code>, <code>/* wp-bot-logo-palette */</code>,
    and <code>/* wp-bot-responsive */</code>. You can edit other CSS freely; those
    blocks are replaced on each run.
  </>,
  <>
    Re-uploading a theme zip through Phase 1 overwrites any manual edits you made
    to theme files on the server.
  </>,
  <>
    Environment overrides live in <code>.env</code>: <code>XAI_MODEL</code>,{" "}
    <code>XAI_TIMEOUT_MS</code>, <code>CONTENT_FORMAT</code>,{" "}
    <code>DESIGN_REFERENCE_MAX</code>, and the upload directories.
  </>,
];

function StepList({ steps, offset = 0 }: { steps: Step[]; offset?: number }) {
  return (
    <ol className="space-y-4">
      {steps.map((step, index) => (
        <li
          key={step.title}
          className="flex gap-4 rounded-xl border border-border bg-white p-5 shadow-sm"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white">
            {offset + index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="text-base font-semibold text-slate-900">{step.title}</h3>
              {step.where ? (
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                  {step.where}
                </span>
              ) : null}
            </div>
            <div className="guide-prose mt-2 space-y-2 text-sm leading-relaxed text-slate-700">
              {step.body}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function SectionHeading({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="text-sm text-muted">{description}</p>
      </div>
    </div>
  );
}

export default function HowToUsePage() {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary-hover"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to dashboard
      </Link>

      <header className="mb-8">
        <p className="text-sm font-medium uppercase tracking-wide text-primary">
          Grok WordPress Automation
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">
          How to Use
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Every step from first launch to a fully built, SEO-ready WordPress site
          with ongoing blog, update, and social automation.
        </p>
      </header>

      <nav className="mb-8 flex flex-wrap gap-2 text-sm">
        {[
          ["#setup", "1. Setup"],
          ["#build", "2. Build the site"],
          ["#automation", "3. Ongoing automation"],
          ["#troubleshooting", "4. Troubleshooting"],
          ["#tips", "5. Tips"],
        ].map(([href, label]) => (
          <a
            key={href}
            href={href}
            className="rounded-full bg-white px-4 py-2 font-medium text-slate-600 ring-1 ring-border hover:bg-slate-50"
          >
            {label}
          </a>
        ))}
      </nav>

      <div className="space-y-8">
        <section
          id="setup"
          className="scroll-mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8"
        >
          <SectionHeading
            icon={KeyRound}
            title="Setup (one time per site)"
            description="Connect Grok and WordPress, describe the business, pick the pages."
          />
          <StepList steps={SETUP_STEPS} />
        </section>

        <section
          id="build"
          className="scroll-mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8"
        >
          <SectionHeading
            icon={Rocket}
            title="Build the website (Phases 1–3)"
            description="Run each phase from the footer buttons. They can be re-run independently."
          />
          <StepList steps={BUILD_STEPS} offset={SETUP_STEPS.length} />
        </section>

        <section
          id="automation"
          className="scroll-mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8"
        >
          <SectionHeading
            icon={ClipboardList}
            title="Ongoing automation (Phases 4–8)"
            description="Blogs, refreshes, social posts, the connected pipeline, and approvals."
          />
          <StepList
            steps={AUTOMATION_STEPS}
            offset={SETUP_STEPS.length + BUILD_STEPS.length}
          />
        </section>

        <section
          id="troubleshooting"
          className="scroll-mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8"
        >
          <SectionHeading
            icon={Bug}
            title="Troubleshooting"
            description="Common log messages and what to do about them."
          />
          <dl className="divide-y divide-border rounded-xl border border-border bg-white">
            {TROUBLESHOOTING.map((item) => (
              <div key={item.problem} className="grid gap-1 px-5 py-4 sm:grid-cols-3 sm:gap-4">
                <dt className="text-sm font-semibold text-slate-900">{item.problem}</dt>
                <dd className="guide-prose text-sm leading-relaxed text-slate-700 sm:col-span-2">
                  {item.fix}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section
          id="tips"
          className="scroll-mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8"
        >
          <SectionHeading
            icon={Lightbulb}
            title="Tips"
            description="Small things that make runs faster and results better."
          />
          <ul className="guide-prose space-y-2 text-sm leading-relaxed text-slate-700">
            {TIPS.map((tip, index) => (
              <li key={index} className="flex gap-3">
                <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <footer className="mt-8 text-center text-xs text-muted">
        <Link href="/" className="font-medium text-primary hover:text-primary-hover">
          Return to the Setup Dashboard
        </Link>
      </footer>
    </div>
  );
}
