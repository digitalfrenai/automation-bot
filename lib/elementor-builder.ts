import type { PageSection } from "@/lib/page-content-structure";

function randomId(): string {
  return Math.random().toString(16).slice(2, 9);
}

type ElNode = Record<string, unknown>;

function headingWidget(title: string, size: "h1" | "h2" | "h3"): ElNode {
  return {
    id: randomId(),
    elType: "widget",
    widgetType: "heading",
    settings: {
      title,
      header_size: size,
      align: "center",
    },
    elements: [],
  };
}

function textWidget(html: string): ElNode {
  return {
    id: randomId(),
    elType: "widget",
    widgetType: "text-editor",
    settings: {
      editor: html,
    },
    elements: [],
  };
}

export type PageImageInjection = {
  media: { id: number; source_url: string };
  alt: string;
  role: "hero" | "section";
};

function imageWidget(url: string, alt: string, mediaId?: number): ElNode {
  return {
    id: randomId(),
    elType: "widget",
    widgetType: "image",
    settings: {
      image: {
        url,
        id: mediaId ?? 0,
        alt,
      },
      image_size: "full",
    },
    elements: [],
  };
}

function buttonWidget(text: string, url: string): ElNode {
  return {
    id: randomId(),
    elType: "widget",
    widgetType: "button",
    settings: {
      text,
      link: { url, is_external: false, nofollow: false },
      align: "center",
      size: "md",
    },
    elements: [],
  };
}

function section(widgets: ElNode[]): ElNode {
  return {
    id: randomId(),
    elType: "section",
    settings: {
      layout: "boxed",
      content_width: { unit: "px", size: 1140 },
    },
    elements: [
      {
        id: randomId(),
        elType: "column",
        settings: { _column_size: 100 },
        elements: widgets,
      },
    ],
  };
}

function sectionFromPageSection(block: PageSection): ElNode {
  const widgets: ElNode[] = [];

  if (block.image_url?.trim()) {
    widgets.push(
      imageWidget(
        block.image_url.trim(),
        block.image_alt?.trim() || block.heading || "Page image",
        block.image_media_id
      )
    );
  }

  if (block.heading) {
    const size =
      block.kind === "hero" ? "h1" : block.kind === "content" ? "h2" : "h2";
    widgets.push(headingWidget(block.heading, size));
  }
  if (block.subheading) {
    widgets.push(
      textWidget(`<p><strong>${escape(block.subheading)}</strong></p>`)
    );
  }
  if (block.body_html?.trim()) {
    widgets.push(textWidget(block.body_html));
  }
  if (block.items?.length) {
    const list = block.items
      .map(
        (item) =>
          `<p><strong>${escape(item.title)}</strong><br/>${escape(item.text)}</p>`
      )
      .join("");
    widgets.push(textWidget(list));
  }
  if (block.button_text) {
    widgets.push(
      buttonWidget(block.button_text, block.button_url || "/contact")
    );
  }

  if (widgets.length === 0) {
    widgets.push(textWidget("<p>Content</p>"));
  }

  return section(widgets);
}

function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export type ElementorBuiltPage = {
  elementorData: string;
  /** Minimal post_content Elementor can fall back to if meta is stripped. */
  storageHtml: string;
};

export function buildElementorPage(sections: PageSection[]): ElementorBuiltPage {
  const data = sections.map((s) => sectionFromPageSection(s));
  const elementorData = JSON.stringify(data);

  const storageHtml = sections
    .map((s) => {
      const img = s.image_url
        ? `<figure><img src="${escape(s.image_url)}" alt="${escape(s.image_alt ?? s.heading ?? "Image")}"/></figure>`
        : "";
      const h = s.heading ? `<h2>${escape(s.heading)}</h2>` : "";
      const body = s.body_html ?? "";
      return `<section>${img}${h}${body}</section>`;
    })
    .join("\n");

  return { elementorData, storageHtml };
}

export function elementorMetaPayload(elementorData: string): Record<string, string> {
  return {
    _elementor_edit_mode: "builder",
    _elementor_template_type: "wp-page",
    _elementor_version: "3.24.0",
    _elementor_data: elementorData,
  };
}

/** Plain HTML for SEO from Elementor snapshot content. */
export function elementorStorageToAuditHtml(storageHtml: string): string {
  return storageHtml;
}

function columnWidgets(sectionNode: ElNode): ElNode[] | null {
  const columns = sectionNode.elements;
  if (!Array.isArray(columns) || columns.length === 0) return null;
  const col = columns[0] as ElNode;
  if (!Array.isArray(col.elements)) {
    col.elements = [];
  }
  return col.elements as ElNode[];
}

export function injectImagesIntoElementorPrepared(
  prepared: {
    format: "elementor";
    storage: {
      format: "elementor";
      html: string;
      meta?: Record<string, string>;
    };
    auditHtml: string;
  },
  images: PageImageInjection[]
): {
  format: "elementor";
  storage: { format: "elementor"; html: string; meta?: Record<string, string> };
  auditHtml: string;
} {
  if (images.length === 0) return prepared;
  const rawData = prepared.storage.meta?._elementor_data;
  if (!rawData?.trim()) {
    return prepared;
  }

  let sections: ElNode[];
  try {
    sections = JSON.parse(rawData) as ElNode[];
  } catch {
    return prepared;
  }
  if (!Array.isArray(sections)) return prepared;

  const hero = images.find((i) => i.role === "hero") ?? images[0];
  const rest = images.filter((i) => i !== hero);
  const ordered = [hero, ...rest];

  ordered.forEach((img, index) => {
    const sectionNode = sections[index];
    if (!sectionNode) return;
    const widgets = columnWidgets(sectionNode);
    if (!widgets) return;
    widgets.unshift(
      imageWidget(img.media.source_url, img.alt, img.media.id)
    );
  });

  const elementorData = JSON.stringify(sections);
  let storageHtml = prepared.storage.html;
  storageHtml = applyImagesToElementorSnapshotHtml(storageHtml, ordered);

  return {
    format: "elementor",
    storage: {
      format: "elementor",
      html: storageHtml,
      meta: elementorMetaPayload(elementorData),
    },
    auditHtml: elementorStorageToAuditHtml(storageHtml),
  };
}

function applyImagesToElementorSnapshotHtml(
  html: string,
  images: PageImageInjection[]
): string {
  const parts = html.split(/(?=<section\b)/i);
  if (parts.length <= 1) {
    const hero = images[0];
    if (!hero) return html;
    return `${htmlHeroFigure(hero.media.source_url, hero.alt)}${html}`;
  }

  return parts
    .map((part, index) => {
      if (index === 0 && !part.trim()) return part;
      const img = images[index - 1];
      if (!img || !/^<section\b/i.test(part)) return part;
      const figure = htmlHeroFigure(img.media.source_url, img.alt);
      return part.replace(/(<section\b[^>]*>)/i, `$1${figure}`);
    })
    .join("");
}

function htmlHeroFigure(url: string, alt: string): string {
  const safeAlt = alt.replace(/"/g, "&quot;");
  return `<figure><img src="${url}" alt="${safeAlt}"/></figure>`;
}
