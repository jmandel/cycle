import { join } from "node:path";

export type ViewerVariant = {
  id: "view" | "view2" | "view3";
  label: string;
  pageName: string;
  assetsDirName: string;
  entry: string;
  template: string;
  expectedText: string;
  demoButtonText: string;
};

const root = `${import.meta.dir}/..`;

export const viewerVariants: ViewerVariant[] = [
  {
    id: "view",
    label: "viewer v1",
    pageName: "view.html",
    assetsDirName: "view-assets",
    entry: join(root, "viewer-src", "view", "app.jsx"),
    template: join(root, "viewer-src", "view", "index.html"),
    expectedText: "Menstrual cycle review",
    demoButtonText: "Load the synthetic demo",
  },
  {
    id: "view2",
    label: "viewer v2",
    pageName: "view2.html",
    assetsDirName: "view2-assets",
    entry: join(root, "viewer-src", "view2", "app.jsx"),
    template: join(root, "viewer-src", "view2", "index.html"),
    expectedText: "Menstrual summary",
    demoButtonText: "Load synthetic demo",
  },
  {
    id: "view3",
    label: "viewer v3",
    pageName: "view3.html",
    assetsDirName: "view3-assets",
    entry: join(root, "viewer-src", "view3", "app.jsx"),
    template: join(root, "viewer-src", "view3", "index.html"),
    expectedText: "Bleeding-first clinical summary",
    demoButtonText: "Load the synthetic demo",
  },
];

export function viewerVariant(id: ViewerVariant["id"]) {
  const variant = viewerVariants.find((v) => v.id === id);
  if (!variant) throw new Error(`unknown viewer variant: ${id}`);
  return variant;
}

export function viewerOutput(variant: ViewerVariant, outRoot: string) {
  return {
    page: join(outRoot, variant.pageName),
    assets: join(outRoot, variant.assetsDirName),
  };
}

export function viewerBuildEnv(variant: ViewerVariant, outRoot: string) {
  const output = viewerOutput(variant, outRoot);
  return {
    VIEWER_OUTDIR: output.assets,
    VIEWER_PAGE_OUT: output.page,
    VIEWER_ENTRY: variant.entry,
    VIEWER_TEMPLATE: variant.template,
  };
}
