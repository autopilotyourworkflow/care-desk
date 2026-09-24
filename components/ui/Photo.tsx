/* eslint-disable @next/next/no-img-element -- static export with unoptimized images: a plain responsive img is the right tool */
import type { ImgHTMLAttributes } from "react";
import { cn } from "./cn";

/**
 * The photos in public/images, each exported at two widths as WebP. Aspect is width / height of the crop.
 * All from Unsplash (free under the Unsplash License); see public/images/credits.txt.
 */
export const PHOTOS = {
  agent: { widths: [560, 960], aspect: 4 / 5, alt: "A support agent reading a message at her desk" },
  patient: { widths: [720, 1200], aspect: 4 / 3, alt: "A patient writing a message on her phone at home" },
  clinician: { widths: [720, 1200], aspect: 4 / 3, alt: "A clinician on a video call with a patient" },
  "leaves-light": { widths: [1200, 2000], aspect: 16 / 9, alt: "" },
  "leaves-deep": { widths: [1200, 2000], aspect: 16 / 9, alt: "" },
  beam: { widths: [240, 480], aspect: 1, alt: "Chanon Poovaviranon (Beam)" },
} as const;

export type PhotoName = keyof typeof PHOTOS;

export function photoSrc(name: PhotoName, width?: number): string {
  const w = width ?? PHOTOS[name].widths[0];
  return `/images/${name}-${w}.webp`;
}

export interface PhotoProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet" | "width" | "height"> {
  name: PhotoName;
  /** The rendered width hint for the browser, for example "(min-width: 1024px) 480px, 100vw". */
  sizes?: string;
  /** The above-the-fold hero: loads eagerly with high priority. Everything else is lazy. */
  priority?: boolean;
}

/** A responsive photo from public/images. Set the frame (size, radius) with className; the image covers it. */
export function Photo({ name, sizes = "100vw", priority, alt, className, ...rest }: PhotoProps) {
  const p = PHOTOS[name];
  const [small, large] = p.widths;
  return (
    <img
      src={photoSrc(name, large)}
      srcSet={`${photoSrc(name, small)} ${small}w, ${photoSrc(name, large)} ${large}w`}
      sizes={sizes}
      width={large}
      height={Math.round(large / p.aspect)}
      alt={alt ?? p.alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={priority ? "high" : undefined}
      className={cn("block h-full w-full object-cover", className)}
      {...rest}
    />
  );
}
