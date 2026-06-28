export const project = {
  outDir: process.env.OUT_DIR || 'site-gen/out',
  designDir: process.env.SITE_DESIGN_DIR || 'site-gen/designs/cycle',
  projectCss: process.env.SITE_PROJECT_CSS || 'site-gen/project/cycle.css',
  contentDir: process.env.SITE_CONTENT_DIR || 'input/pagecontent',
  imageDir: process.env.SITE_IMAGE_DIR || 'input/images',
  liquidAssetDirs: process.env.SITE_LIQUID_ASSET_DIRS?.split(',').filter(Boolean) || ['input/includes', 'template/includes'],
  externalLinks: process.env.SITE_EXTERNAL_LINKS?.split(',').filter(Boolean) || ['../*.zip', '../*.tgz', '*.zip', '*.tgz'],
  cname: process.env.SITE_CNAME || '',
  packageList: process.env.SITE_PACKAGE_LIST || '',
  brand: {
    wordmark: process.env.SITE_BRAND_WORDMARK || 'FHIR IG',
    tld: process.env.SITE_BRAND_TLD || '',
    mark: process.env.SITE_BRAND_MARK || '',
    tagline: process.env.SITE_BRAND_TAGLINE || 'FHIR implementation guide.',
  },
  footer: {
    guide: [
      { label: 'Home', href: 'index.html' },
      { label: 'Artifacts', href: 'artifacts.html' },
    ],
  },
  profileGroups: [],
};
