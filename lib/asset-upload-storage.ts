import path from "path";

export function getBlogImageUploadDir() {
  return path.join(process.cwd(), "public", "uploads", "blog-images");
}

export function blogImagePublicPath(filename: string) {
  return `/uploads/blog-images/${filename}`;
}

export function resolveStoredBlogImagePath(publicPath: string): string {
  const name = path.basename(publicPath);
  return path.join(getBlogImageUploadDir(), name);
}

export function getPageImageUploadDir() {
  return path.join(process.cwd(), "public", "uploads", "page-images");
}

export function pageImagePublicPath(filename: string) {
  return `/uploads/page-images/${filename}`;
}

export function resolveStoredPageImagePath(publicPath: string): string {
  const name = path.basename(publicPath);
  return path.join(getPageImageUploadDir(), name);
}