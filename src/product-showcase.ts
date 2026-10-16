export type ShowcaseProduct = {
  id: string;
  title: string;
  category: string;
  imageUrl: string;
  alt: string;
};

type ShowcaseDefinition = ShowcaseProduct & {
  asset: string;
  mimeType: 'image/jpeg' | 'image/png';
  matchTerms: readonly string[];
};

const showcaseDefinitions: readonly ShowcaseDefinition[] = [
  { id: 'mais', title: 'Maïs', category: 'Céréales', imageUrl: '/assets/products/mais.png', alt: 'Grains de maïs jaune dans des sacs en toile', asset: 'mais.png', mimeType: 'image/png', matchTerms: ['mais'] },
  { id: 'arachide', title: 'Arachide', category: 'Légumineuses', imageUrl: '/assets/products/arachide.jpg', alt: 'Arachides locales présentées dans un bol', asset: 'arachide.jpg', mimeType: 'image/jpeg', matchTerms: ['arachide'] },
  { id: 'cacao', title: 'Cacao', category: 'Cacao & café', imageUrl: '/assets/products/cacao.jpg', alt: 'Cacao local présenté avec des fèves', asset: 'cacao.jpg', mimeType: 'image/jpeg', matchTerms: ['cacao'] },
  { id: 'cafe', title: 'Café', category: 'Cacao & café', imageUrl: '/assets/products/cafe.jpg', alt: 'Produit de café local', asset: 'cafe.jpg', mimeType: 'image/jpeg', matchTerms: ['cafe'] },
  { id: 'haricot-blanc-du-koki', title: 'Haricot blanc du Koki', category: 'Légumineuses', imageUrl: '/assets/products/haricot-blanc-du-koki.jpg', alt: 'Haricots blancs du Koki', asset: 'haricot-blanc-du-koki.jpg', mimeType: 'image/jpeg', matchTerms: ['haricot blanc du koki', 'haricot blanc'] },
  { id: 'haricot-rouge', title: 'Haricot rouge', category: 'Légumineuses', imageUrl: '/assets/products/haricot-rouge.jpg', alt: 'Haricots rouges locaux', asset: 'haricot-rouge.jpg', mimeType: 'image/jpeg', matchTerms: ['haricot rouge'] },
  { id: 'haricot-noir', title: 'Haricot noir', category: 'Légumineuses', imageUrl: '/assets/products/haricot-noir.jpg', alt: 'Haricots noirs locaux', asset: 'haricot-noir.jpg', mimeType: 'image/jpeg', matchTerms: ['haricot noir'] },
  { id: 'riz-de-yagoua', title: 'Riz de Yagoua', category: 'Céréales', imageUrl: '/assets/products/riz-de-yagoua.jpg', alt: 'Riz de Yagoua', asset: 'riz-de-yagoua.jpg', mimeType: 'image/jpeg', matchTerms: ['riz de yagoua', 'riz yagoua'] },
  { id: 'soja', title: 'Soja', category: 'Légumineuses', imageUrl: '/assets/products/soja.jpg', alt: 'Graines de soja locales', asset: 'soja.jpg', mimeType: 'image/jpeg', matchTerms: ['soja'] },
  { id: 'folere-legume', title: 'Foléré (légume)', category: 'Feuilles & légumes', imageUrl: '/assets/products/folere-legume.jpg', alt: 'Foléré frais', asset: 'folere-legume.jpg', mimeType: 'image/jpeg', matchTerms: ['folere'] },
  { id: 'okok', title: 'Okok', category: 'Feuilles & légumes', imageUrl: '/assets/products/okok.jpg', alt: 'Okok local', asset: 'okok.jpg', mimeType: 'image/jpeg', matchTerms: ['okok'] },
  { id: 'moringa', title: 'Moringa', category: 'Plantes & feuilles', imageUrl: '/assets/products/moringa.jpg', alt: 'Moringa local', asset: 'moringa.jpg', mimeType: 'image/jpeg', matchTerms: ['moringa'] },
  { id: 'neem', title: 'Neem', category: 'Plantes & feuilles', imageUrl: '/assets/products/neem.jpg', alt: 'Neem local', asset: 'neem.jpg', mimeType: 'image/jpeg', matchTerms: ['neem'] },
  { id: 'huile-de-palme', title: 'Huile de palme', category: 'Produits transformés', imageUrl: '/assets/products/huile-de-palme.jpg', alt: 'Huile de palme locale', asset: 'huile-de-palme.jpg', mimeType: 'image/jpeg', matchTerms: ['huile de palme'] },
  { id: 'miel', title: 'Miel', category: 'Produits transformés', imageUrl: '/assets/products/miel.jpg', alt: 'Miel local', asset: 'miel.jpg', mimeType: 'image/jpeg', matchTerms: ['miel'] },
  { id: 'jus-de-folere', title: 'Jus de foléré', category: 'Produits transformés', imageUrl: '/assets/products/jus-de-folere.jpg', alt: 'Jus de foléré local', asset: 'jus-de-folere.jpg', mimeType: 'image/jpeg', matchTerms: ['jus de folere'] },
  { id: 'tasba', title: 'Tasba', category: 'Produit local', imageUrl: '/assets/products/tasba.jpg', alt: 'Tasba local', asset: 'tasba.jpg', mimeType: 'image/jpeg', matchTerms: ['tasba'] },
];

const normalize = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

export const productShowcase: readonly ShowcaseProduct[] = showcaseDefinitions.map(({ asset: _asset, mimeType: _mimeType, matchTerms: _matchTerms, ...product }) => product);

export const findProductImageAsset = (asset: string) => showcaseDefinitions.find((product) => product.asset === asset);

export function getProductImageUrl(title: string, imageUrl: string | null) {
  if (imageUrl) return imageUrl;
  const normalizedTitle = normalize(title);
  return showcaseDefinitions.find((product) => product.matchTerms.some((term) => normalizedTitle.includes(normalize(term))))?.imageUrl ?? null;
}
