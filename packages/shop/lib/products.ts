export interface Product {
  slug:       string;
  name:       string;
  tagline:    string;
  price:      number;            // USD
  image:      string;
  description: string;
  sizes?:     readonly string[]; // optional; render size selector when present
}

export const PRODUCTS: readonly Product[] = [
  {
    slug:    "cap",
    name:    "Arcora Cap",
    tagline: "Embroidered logo, Pay-from-anywhere stitch",
    price:   9.99,
    image:   "/products/cap.jpg",
    description:
      "Heavy 100% cotton twill, six-panel structured crown, brass slide buckle. Front embroidery in Arcora blue and teal; side embroidery reads Pay from anywhere.",
  },
  {
    slug:    "tee",
    name:    "Arcora Tee",
    tagline: "Stablecoin Checkout & Settlement on Arc",
    price:   9.99,
    image:   "/products/tee.jpg",
    sizes:   ["S", "M", "L", "XL"],
    description:
      "Mid-weight 220 gsm combed cotton, unisex cut. Small chest mark front, full lockup with strapline on the back. Pre-shrunk, machine washable.",
  },
  {
    slug:    "mug",
    name:    "Arcora Mug",
    tagline: "Ceramic, 11oz, full-color print",
    price:   9.99,
    image:   "/products/mug.jpg",
    description:
      "Glossy white ceramic, dishwasher and microwave safe. Front carries the Arcora mark; opposite side has the horizontal lockup with the Stablecoin Checkout & Settlement on Arc strapline.",
  },
  {
    slug:    "stickers",
    name:    "Sticker Pack",
    tagline: "Four die-cut vinyl stickers",
    price:   9.99,
    image:   "/products/stickers.svg",
    description:
      "Set of four — large mark, full lockup, Pay-from-anywhere wordmark, and a teal arc icon. Weatherproof matte vinyl, laptop-safe adhesive.",
  },
] as const;

export function getProduct(slug: string): Product | undefined {
  return PRODUCTS.find(p => p.slug === slug);
}
